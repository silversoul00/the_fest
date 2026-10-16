import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cache } from 'react';
import { sql } from './db';
import type { Role, User } from './types';

/*
 * Sessions
 * ────────
 * • App session  (tf_session): 30-day cookie. Student / Organizer / Sponsor
 *   stay signed in, so they pick their role once and land in their portal.
 * • Scanner session (tf_scan): browser-session cookie (no Max-Age) and a
 *   12-hour server expiry. Closing the browser or tapping "Lock" ends it —
 *   the gate scanner always re-authenticates.
 * Only a SHA-256 of the token is stored, so a DB leak can't hijack sessions.
 */

export const APP_COOKIE = 'tf_session';
export const SCAN_COOKIE = 'tf_scan';
const APP_TTL_DAYS = 30;
const SCAN_TTL_HOURS = 12;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const secure = process.env.NODE_ENV === 'production';

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 11);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, kind: 'app' | 'scanner') {
  const token = randomBytes(32).toString('base64url');
  const ms = kind === 'app' ? APP_TTL_DAYS * 864e5 : SCAN_TTL_HOURS * 36e5;
  const expires = new Date(Date.now() + ms);
  await sql`insert into sessions (token_hash, user_id, kind, expires_at)
            values (${sha256(token)}, ${userId}, ${kind}, ${expires})`;
  const jar = await cookies();
  jar.set(kind === 'app' ? APP_COOKIE : SCAN_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    // scanner: no maxAge → dies with the browser
    ...(kind === 'app' ? { expires } : {}),
  });
}

export async function destroySession(kind: 'app' | 'scanner') {
  const jar = await cookies();
  const name = kind === 'app' ? APP_COOKIE : SCAN_COOKIE;
  const token = jar.get(name)?.value;
  if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
  jar.delete(name);
}

async function userFromCookie(name: string, kind: 'app' | 'scanner'): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(name)?.value;
  if (!token) return null;
  const rows = await sql<User[]>`
    select u.id, u.email::text, u.name, u.phone, u.college, u.role, u.created_at, u.is_admin
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.kind = ${kind} and s.expires_at > now()`;
  const u = rows[0];
  if (!u) return null;
  return { ...u, is_admin: u.is_admin || adminEmails().includes(u.email.toLowerCase()) };
}

/** Current app user (memoised per request). */
export const getUser = cache(() => userFromCookie(APP_COOKIE, 'app'));

/** Current gate-scanner user (memoised per request). */
export const getScanner = cache(() => userFromCookie(SCAN_COOKIE, 'scanner'));

export const PORTAL: Record<Role, string> = {
  student: '/fests',
  organizer: '/organizer',
  sponsor: '/sponsor',
};

/** Use in server components/actions: returns the user or redirects to login. */
export async function requireUser(role?: Role): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');
  if (role && user.role !== role) redirect(PORTAL[user.role]);
  return user;
}

/** Platform admins: users.is_admin, or emails listed in ADMIN_EMAILS (comma-separated). */
export const adminEmails = () => (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

export async function requireAdmin(): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login?next=/admin');
  if (!user.is_admin) redirect(PORTAL[user.role]);
  return user;
}

export function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}

// Light brute-force protection: max 10 failed logins per email per 15 min.
const attempts = new Map<string, { n: number; until: number }>();
export function loginThrottled(email: string): boolean {
  const a = attempts.get(email);
  return !!a && a.n >= 10 && a.until > Date.now();
}
export function noteFailedLogin(email: string) {
  const a = attempts.get(email);
  if (!a || a.until < Date.now()) attempts.set(email, { n: 1, until: Date.now() + 15 * 6e4 });
  else a.n++;
}
export function clearFailedLogins(email: string) {
  attempts.delete(email);
}

import 'server-only';
import { cookies, headers } from 'next/headers';
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
    select u.id, u.email::text, u.name, u.phone, u.college, u.role, u.created_at, u.is_admin,
           (u.email_verified_at is not null) as verified
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.kind = ${kind} and s.expires_at > now()`;
  const u = rows[0];
  if (!u) return null;
  // ADMIN_EMAILS only counts for a verified inbox — otherwise anyone could sign up with that address first.
  return { ...u, is_admin: u.is_admin || (u.verified && adminEmails().includes(u.email.toLowerCase())) };
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

/*
 * Brute-force protection, kept in the database (login_attempts) so it holds across every server
 * instance and restart — on Vercel each request may hit a different instance.
 *  • Per email + network (IP): 10 failed logins per 15 minutes. A stranger guessing a volunteer's
 *    password from their own phone locks only themselves out, not the volunteer at the gate.
 *  • Per email, from anywhere: 50 failed logins per 15 minutes (looser cap against spread-out guessing).
 * App login and scanner login share the counters.
 * If the table is missing or the database hiccups, the throttle FAILS OPEN (people can still log in)
 * and the problem is logged to /admin/errors — /api/health also reports the missing table.
 */
export const MAX_FAILS_PER_IP = 10;
export const MAX_FAILS_PER_EMAIL = 50;

/** The visitor's IP: first address in x-forwarded-for (Vercel sets this), else x-real-ip. */
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const first = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
    return (first || (h.get('x-real-ip') ?? '').trim() || 'unknown').slice(0, 64).toLowerCase();
  } catch {
    return 'unknown';
  }
}

async function throttleKeys(email: string) {
  const e = normalizeEmail(email);
  return { ipKey: `ip:${e}|${await clientIp()}`, emailKey: `e:${e}` };
}

async function logThrottleError(err: unknown, where: string) {
  const { reportError } = await import('./errors');
  await reportError(err, where);
}

export async function loginThrottled(email: string): Promise<boolean> {
  try {
    const { ipKey, emailKey } = await throttleKeys(email);
    const [r] = await sql<{ blocked: boolean }[]>`
      select coalesce(bool_or(window_start > now() - interval '15 minutes' and
               fails >= case when key = ${ipKey} then ${MAX_FAILS_PER_IP}::int else ${MAX_FAILS_PER_EMAIL}::int end), false) as blocked
      from login_attempts where key in (${ipKey}, ${emailKey})`;
    return !!r?.blocked;
  } catch (err) {
    await logThrottleError(err, 'login throttle (failing open)');
    return false;
  }
}

export async function noteFailedLogin(email: string) {
  try {
    const { ipKey, emailKey } = await throttleKeys(email);
    await sql`
      insert into login_attempts (key, fails, window_start) values (${ipKey}, 1, now()), (${emailKey}, 1, now())
      on conflict (key) do update set
        fails = case when login_attempts.window_start < now() - interval '15 minutes' then 1 else login_attempts.fails + 1 end,
        window_start = case when login_attempts.window_start < now() - interval '15 minutes' then now() else login_attempts.window_start end`;
    // Made-up emails each leave a row; now and then clear out ones idle for a day.
    if (Math.random() < 0.02) await sql`delete from login_attempts where window_start < now() - interval '1 day'`;
  } catch (err) {
    await logThrottleError(err, 'login throttle (failing open)');
  }
}

export async function clearFailedLogins(email: string) {
  try {
    const { ipKey, emailKey } = await throttleKeys(email);
    await sql`delete from login_attempts where key in (${ipKey}, ${emailKey})`;
  } catch (err) {
    await logThrottleError(err, 'login throttle (failing open)');
  }
}

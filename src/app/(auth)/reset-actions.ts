'use server';
import { createHash, randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { createSession, hashPassword, normalizeEmail, PORTAL } from '@/lib/auth';
import { sendEmail } from '@/lib/mail';
import { siteUrl } from '@/lib/env';
import { reportError } from '@/lib/errors';
import type { ActionState, Role } from '@/lib/types';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Always answers the same way, so nobody can use this form to find out who has an account. */
export async function requestReset(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get('email') ?? ''));
  const done: ActionState = { ok: true, message: 'If an account exists for that email, a reset link is on its way. It works for 1 hour.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter the email you signed up with.' };
  let site: string;
  try { site = siteUrl(); } catch (e) {
    // Same answer for every email, so this can't reveal who has an account
    await reportError(e, 'password reset');
    return { error: 'Password reset emails aren’t switched on yet. Please contact support.' };
  }

  const [u] = await sql<{ id: string; name: string }[]>`select id, name from users where email = ${email}`;
  if (!u) return done;
  // At most 3 reset emails per account per hour
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from password_resets where user_id = ${u.id} and created_at > now() - interval '1 hour'`;
  if (n >= 3) return done;

  const token = randomBytes(32).toString('base64url');
  await sql`insert into password_resets (token_hash, user_id, expires_at) values (${sha256(token)}, ${u.id}, now() + interval '1 hour')`;
  await sendEmail(email, 'Reset your THE FEST password', [
    `Hi ${u.name.split(' ')[0]},`,
    '',
    'Someone (hopefully you) asked to reset your THE FEST password. Open this link within 1 hour:',
    '',
    `${site}/reset-password?token=${token}`,
    '',
    'If you didn’t ask for this, ignore this email — your password stays the same.',
    '',
    '— THE FEST',
  ].join('\n'));
  return done;
}

export async function resetPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get('token') ?? '');
  const pw = String(fd.get('password') ?? '');
  if (pw.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (pw !== String(fd.get('confirm') ?? '')) return { error: 'The two passwords don’t match.' };
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { error: 'This reset link is invalid. Ask for a new one.' };

  const [r] = await sql<{ user_id: string; role: Role }[]>`
    update password_resets pr set used_at = now()
    from users u
    where pr.token_hash = ${sha256(token)} and pr.used_at is null and pr.expires_at > now() and u.id = pr.user_id
    returning pr.user_id, u.role`;
  if (!r) return { error: 'This reset link has expired or was already used. Ask for a new one.' };

  // Using the emailed link also proves they own the inbox
  await sql`update users set password_hash = ${await hashPassword(pw)}, email_verified_at = coalesce(email_verified_at, now()) where id = ${r.user_id}`;
  // Sign out everywhere (including any scanner session), then sign in here
  await sql`delete from sessions where user_id = ${r.user_id}`;
  await sql`update password_resets set used_at = coalesce(used_at, now()) where user_id = ${r.user_id}`;
  await createSession(r.user_id, 'app');
  redirect(PORTAL[r.role]);
}

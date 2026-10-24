import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { sendEmail } from './mail';
import { siteUrl } from './env';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Emails a 48-hour verification link. Max 3 per account per hour. Returns false if throttled. */
export async function sendVerification(userId: string): Promise<boolean> {
  const site = siteUrl(); // throws first if the site address isn't set, so no unusable token is stored
  const [u] = await sql<{ email: string; name: string; verified: boolean }[]>`
    select email::text, name, email_verified_at is not null as verified from users where id = ${userId}`;
  if (!u || u.verified) return true;
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int n from email_verifications where user_id = ${userId} and created_at > now() - interval '1 hour'`;
  if (n >= 3) return false;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into email_verifications (token_hash, user_id, expires_at) values (${sha256(token)}, ${userId}, now() + interval '48 hours')`;
  await sendEmail(u.email, 'Confirm your email for THE FEST', [
    `Hi ${u.name.split(' ')[0]},`, '',
    'Tap to confirm this is your email address:', '',
    `${site}/verify-email?token=${token}`, '',
    'You need this before a fest can add you as a co-organizer, volunteer or sponsor.', '',
    'If you didn’t sign up for THE FEST, ignore this email.', '', '— THE FEST',
  ].join('\n'));
  return true;
}

/** Marks the email verified if the token is valid. Returns the user id, or null. */
export async function consumeVerification(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [r] = await sql<{ user_id: string }[]>`
    update email_verifications set used_at = now()
    where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
    returning user_id`;
  if (!r) return null;
  await sql`update users set email_verified_at = coalesce(email_verified_at, now()) where id = ${r.user_id}`;
  return r.user_id;
}

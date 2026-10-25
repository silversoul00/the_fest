'use server';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import {
  clearFailedLogins, createSession, destroySession, countLoginAttempt, normalizeEmail, loginBlockedMessage, verifyPassword,
} from '@/lib/auth';
import { scannableFests } from '@/lib/queries';
import { rolesReady } from '@/lib/fest-access';
import { dateRange } from '@/lib/format';
import { sendVerification } from '@/lib/verify';
import { reportError } from '@/lib/errors';
import type { ActionState, User } from '@/lib/types';

export async function scannerLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get('email') ?? ''));
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  // Count the attempt first, then decide — so a burst of parallel guesses can't overshoot the limit.
  const gate = await countLoginAttempt(email);
  if (gate !== 'ok') return { error: loginBlockedMessage(gate) };

  const [u] = await sql<(User & { password_hash: string })[]>`
    select id, email::text, name, phone, college, role, created_at, password_hash, (email_verified_at is not null) as verified
    from users where email = ${email}`;
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    return { error: 'Wrong email or password.' };
  }
  await clearFailedLogins(email);
  const all = await scannableFests(u);
  const fests = all.filter((f) => f.counters.length);
  if (!all.length && !u.verified && (await rolesReady())
      && (await sql`select 1 from fest_roles where email = ${email} and (can_scan or role = 'co_organizer')`).length) {
    await sendVerification(u.id).catch((e) => reportError(e, 'verification email'));
    return { error: `Confirm your email first — we’ve sent a link to ${email}. Open it, then unlock the scanner again.` };
  }
  const later = all.find((f) => f.shift_day);
  if (!fests.length && later) return { error: `Your shift at ${later.name} is on ${dateRange(later.shift_day!, later.shift_day!)}. The scanner opens for you that day.` };
  if (!fests.length) return { error: 'You’re not on any fest’s gate team yet. Ask the organizer to add your email under Team.' };

  await createSession(u.id, 'scanner');
  redirect('/scan');
}

export async function lockScanner() {
  await destroySession('scanner');
  redirect('/scan/login');
}

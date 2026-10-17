'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { sql } from '@/lib/db';
import {
  clearFailedLogins, createSession, destroySession, hashPassword, countLoginAttempt,
  normalizeEmail, loginBlockedMessage, PORTAL, verifyPassword,
} from '@/lib/auth';
import { sendVerification } from '@/lib/verify';
import { reportError } from '@/lib/errors';
import type { ActionState, Role } from '@/lib/types';

const safeNext = (n: FormDataEntryValue | null) => {
  const s = typeof n === 'string' ? n : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : '';
};

const SignupSchema = z.object({
  role: z.enum(['student', 'organizer', 'sponsor']),
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.string().trim().email('Enter a valid email').max(160),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  phone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, 'Phone can only contain digits').optional(),
  college: z.string().trim().max(120).optional(),
});

export async function signup(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = SignupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const email = normalizeEmail(d.email);

  const exists = await sql`select 1 from users where email = ${email}`;
  if (exists.length) return { error: 'An account with this email already exists. Log in instead.' };

  const [u] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, name, phone, college, role)
    values (${email}, ${await hashPassword(d.password)}, ${d.name}, ${d.phone || null}, ${d.college || null}, ${d.role})
    returning id`;
  await sendVerification(u.id).catch((e) => reportError(e, 'verification email'));
  await createSession(u.id, 'app');
  redirect(safeNext(fd.get('next')) || (d.role === 'organizer' ? '/organizer/new' : PORTAL[d.role as Role]));
}

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get('email') ?? ''));
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  // Count the attempt first, then decide — so a burst of parallel guesses can't overshoot the limit.
  const gate = await countLoginAttempt(email);
  if (gate !== 'ok') return { error: loginBlockedMessage(gate) };

  const [u] = await sql<{ id: string; password_hash: string; role: Role }[]>`
    select id, password_hash, role from users where email = ${email}`;
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    return { error: 'Wrong email or password.' };
  }
  await clearFailedLogins(email);
  await createSession(u.id, 'app');
  redirect(safeNext(fd.get('next')) || PORTAL[u.role]);
}

export async function logout() {
  await destroySession('app');
  redirect('/login');
}

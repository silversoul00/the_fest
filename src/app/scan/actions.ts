'use server';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import {
  clearFailedLogins, createSession, destroySession, loginThrottled, normalizeEmail, noteFailedLogin, verifyPassword,
} from '@/lib/auth';
import { scannableFests } from '@/lib/queries';
import type { ActionState, User } from '@/lib/types';

export async function scannerLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get('email') ?? ''));
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  if (loginThrottled(email)) return { error: 'Too many attempts. Try again in 15 minutes.' };

  const [u] = await sql<(User & { password_hash: string })[]>`
    select id, email::text, name, phone, college, role, created_at, password_hash from users where email = ${email}`;
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    noteFailedLogin(email);
    return { error: 'Wrong email or password.' };
  }
  clearFailedLogins(email);
  const fests = await scannableFests(u);
  if (!fests.length) return { error: 'You’re not on any fest’s gate team yet. Ask the organizer to add your email under Volunteers.' };

  await createSession(u.id, 'scanner');
  redirect('/scan');
}

export async function lockScanner() {
  await destroySession('scanner');
  redirect('/scan/login');
}

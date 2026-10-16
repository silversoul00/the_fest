'use server';
import { getUser } from '@/lib/auth';
import { sendVerification } from '@/lib/verify';
import type { ActionState } from '@/lib/types';

export async function resendVerification(_: ActionState, __: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: 'Log in first.' };
  if (user.verified) return { ok: true, message: 'Your email is already confirmed.' };
  return (await sendVerification(user.id))
    ? { ok: true, message: `Sent. Check ${user.email} (and spam).` }
    : { error: 'We’ve sent a few already — check your inbox, or try again in an hour.' };
}

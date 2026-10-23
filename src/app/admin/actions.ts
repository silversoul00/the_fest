'use server';
import { revalidatePath } from 'next/cache';
import { normalizeEmail, requireAdmin, unlockLogin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { sendEmail } from '@/lib/mail';
import { siteUrl } from '@/lib/env';
import { afterResponse, reportError } from '@/lib/errors';
import type { ActionState } from '@/lib/types';
import { refundUnfulfilled, retryRefund } from '@/lib/refunds';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const site = siteUrl;

async function festFrom(fd: FormData) {
  const id = s(fd, 'festId');
  if (!isUuid(id)) throw new Error('Fest not found');
  const [f] = await sql<{ id: string; name: string; email: string; status: string }[]>`
    select f.id, f.name, u.email::text, f.status from fests f join users u on u.id = f.organizer_id where f.id = ${id}`;
  if (!f) throw new Error('Fest not found');
  return f;
}

export async function approveFest(fd: FormData) {
  const admin = await requireAdmin();
  const f = await festFrom(fd);
  if (f.status !== 'review') return;
  await sql`update fests set status = 'live', approved_at = now(), approved_by = ${admin.id}, review_note = null where id = ${f.id}`;
  await afterResponse('fest approved email', () => sendEmail(f.email, `${f.name} is live on THE FEST 🎉`, `Your fest has been approved and tickets are on sale now.\n\nManage it: ${site()}/organizer/${f.id}\n\n— THE FEST`));
  revalidatePath('/admin', 'layout');
}

export async function sendBackFest(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const f = await festFrom(fd);
  const note = s(fd, 'note').slice(0, 300);
  if (note.length < 5) return { error: 'Tell the organizer what to fix.' };
  await sql`update fests set status = 'draft', review_note = ${note} where id = ${f.id}`;
  await afterResponse('fest sent back email', () => sendEmail(f.email, `${f.name}: changes needed before going live`, `THE FEST reviewed your fest and needs a change:\n\n${note}\n\nFix it and submit again: ${site()}/organizer/${f.id}\n\n— THE FEST`));
  revalidatePath('/admin', 'layout');
  return { ok: true, message: 'Sent back to the organizer.' };
}

export async function recordPayout(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const f = await festFrom(fd);
  const amount = Math.round(Number(s(fd, 'amount')) * 100);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter the amount you transferred, in rupees.' };
  // payouts.amount_paise is a Postgres int (max ₹2.14 crore) — keep a round, friendly limit below it
  if (amount > 2_000_000_00) return { error: 'One payout can be at most ₹2 crore. Record a bigger transfer as two payouts.' };
  await sql`insert into payouts (fest_id, amount_paise, reference, note, created_by)
            values (${f.id}, ${amount}, ${s(fd, 'reference').slice(0, 60) || null}, ${s(fd, 'note').slice(0, 200) || null}, ${admin.id})`;
  revalidatePath('/admin', 'layout');
  return { ok: true, message: `Recorded ₹${(amount / 100).toLocaleString('en-IN')} paid to ${f.name}.` };
}

export async function retryRefundAction(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'orderId');
  if (!isUuid(id)) return;
  try { await retryRefund(id); } catch (e) { await reportError(e, 'admin retry refund'); }
  revalidatePath('/admin', 'layout');
}

export async function refundUnfulfilledAction(fd: FormData) {
  await requireAdmin();
  const id = s(fd, 'orderId');
  if (!isUuid(id)) return;
  try { await refundUnfulfilled(id); } catch (e) { await reportError(e, 'admin refund'); }
  revalidatePath('/admin', 'layout');
}

/** Clear a "Too many attempts" lockout for one email (e.g. a gate volunteer someone tried to lock out). */
export async function unlockLoginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const email = normalizeEmail(s(fd, 'email'));
  if (!email.includes('@')) return { error: 'Enter the email that is locked out.' };
  try {
    const n = await unlockLogin(email);
    return n ? { ok: true, message: `Unlocked ${email}. They can log in now.` } : { ok: true, message: `${email} wasn’t locked out.` };
  } catch (e) {
    await reportError(e, 'admin unlock login');
    return { error: 'Couldn’t unlock right now — the database setup may be incomplete (see System above).' };
  }
}

'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { transferTicket, TransferError } from '@/lib/transfer';
import type { ActionState } from '@/lib/types';

export async function transferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('student');
  const id = String(fd.get('ticketId') ?? '');
  const email = String(fd.get('email') ?? '').trim();
  if (!isUuid(id)) return { error: 'Ticket not found.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter your friend’s email.' };
  if (String(fd.get('confirm') ?? '') !== 'on') return { error: 'Tick the box to confirm — your QR stops working after this.' };
  try {
    await transferTicket(id, user.id, email);
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message };
    throw e;
  }
  revalidatePath('/tickets');
  // Only the old ticket's id goes in the link — the page looks up who it went to (no text from the URL is shown)
  redirect(`/tickets?sent=${id}`);
}

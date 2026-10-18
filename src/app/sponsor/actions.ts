'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { LEADS_MISSING, OFFER_MAX, leadsReady } from '@/lib/sponsor-leads';
import type { ActionState } from '@/lib/types';

/** "What students get for sharing" — shown on the booth page. Sponsor owner only. */
export async function saveLeadOffer(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('sponsor');
  const id = String(fd.get('id') ?? '');
  const offer = String(fd.get('lead_offer') ?? '').trim().replace(/\s+/g, ' ');
  if (!isUuid(id)) return { error: 'Sponsorship not found.' };
  if (!user.verified) return { error: 'Confirm your email first.' };
  if (offer.length > OFFER_MAX) return { error: `Keep it to ${OFFER_MAX} characters or fewer.` };
  if (!(await leadsReady())) return { error: LEADS_MISSING };
  const r = await sql`update sponsors set lead_offer = ${offer || null} where id = ${id} and email = ${user.email}`;
  if (r.count === 0) return { error: 'Sponsorship not found.' };
  revalidatePath(`/sponsor/${id}`);
  return { ok: true, message: offer ? 'Saved — students see this at your booth.' : 'Removed.' };
}

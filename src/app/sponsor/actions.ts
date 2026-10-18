'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { LEADS_MISSING, OFFER_MAX, leadsReady } from '@/lib/sponsor-leads';
import { afterResponse } from '@/lib/errors';
import { notifySponsorRequest } from '@/lib/mail';
import {
  BRAND_CATEGORIES, LIMITS, REQUESTS_MISSING, createRequest, decideRequest, parseRequestFields, requestsReady, toPaise, visibleToBrands,
  type Decision,
} from '@/lib/sponsor-requests';
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

// ─── Sponsorship requests (v2.6) ──────────────────────────
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim().replace(/\s+/g, ' ');

/** Create or edit the brand profile. "List my brand" puts it in the organizers' Find brands list (and unticking removes it at once). */
export async function saveBrandProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('sponsor');
  if (!user.verified) return { error: 'Confirm your email first.' };
  if (!(await requestsReady())) return { error: REQUESTS_MISSING };
  const brand = str(fd, 'brand');
  const category = str(fd, 'category');
  const about = String(fd.get('about') ?? '').trim();
  const min = toPaise(str(fd, 'budget_min'));
  const max = toPaise(str(fd, 'budget_max'));
  const cities = [...new Set(str(fd, 'cities').split(',').map((c) => c.trim()).filter(Boolean))];
  if (brand.length < 2 || brand.length > LIMITS.brand) return { error: `Brand name: 2 to ${LIMITS.brand} characters.` };
  if (!(category in BRAND_CATEGORIES)) return { error: 'Pick a category.' };
  if (![min, max].every((v) => Number.isFinite(v) && v >= 0 && v <= LIMITS.amountMaxPaise)) return { error: 'Enter the budget in rupees (up to ₹1 crore).' };
  if (max && min > max) return { error: 'The lowest budget is more than the highest.' };
  if (cities.length > LIMITS.cities || cities.some((c) => c.length > LIMITS.city)) return { error: `Up to ${LIMITS.cities} cities, separated by commas.` };
  if (about.length > LIMITS.about) return { error: `Keep "about" to ${LIMITS.about} characters.` };
  const listed = fd.get('listed') === 'on';
  await sql`
    insert into brand_profiles (user_id, brand, category, budget_min_paise, budget_max_paise, cities, about, listed)
    values (${user.id}, ${brand}, ${category}, ${min}, ${max}, string_to_array(${cities.join(',')}, ','), ${about || null}, ${listed})
    on conflict (user_id) do update set brand = excluded.brand, category = excluded.category, budget_min_paise = excluded.budget_min_paise,
      budget_max_paise = excluded.budget_max_paise, cities = excluded.cities, about = excluded.about, listed = excluded.listed, updated_at = now()`;
  revalidatePath('/sponsor', 'layout');
  return { ok: true, message: listed ? 'Saved. Organizers can now find your brand.' : 'Saved. Your brand is not listed for organizers.' };
}

/** "Request to sponsor" from a fest's media kit. */
export async function requestToSponsor(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('sponsor');
  const festId = str(fd, 'festId');
  if (!isUuid(festId)) return { error: 'Fest not found.' };
  if (!user.verified) return { error: 'Confirm your email first.' };
  if (!(await requestsReady())) return { error: REQUESTS_MISSING };
  const [profile] = await sql<{ brand: string }[]>`select brand from brand_profiles where user_id = ${user.id}`;
  if (!profile) redirect('/sponsor/profile?need=1');
  const [f] = await sql`select f.id from fests f where f.id = ${festId} and ${visibleToBrands()}`;
  if (!f) return { error: 'This fest is not open to sponsors right now.' };
  const fields = parseRequestFields(fd);
  if ('error' in fields) return fields;
  const r = await createRequest({ festId, brandUserId: user.id, brand: profile.brand, direction: 'brand_to_org', sentBy: user.id, fields });
  if (r.error) return { error: r.error };
  await afterResponse('sponsor-request', () => notifySponsorRequest(r.id!, 'new'));
  revalidatePath('/sponsor', 'layout');
  return { ok: true, message: 'Request sent. The organizers will see it under Sponsors; you\u2019ll get an email when they answer.' };
}

/** Accept, decline or withdraw — as the brand. Who may do what is checked in decideRequest. */
export async function brandDecide(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('sponsor');
  const id = str(fd, 'id');
  const what = str(fd, 'do') as Decision;
  if (!isUuid(id) || !['accept', 'decline', 'withdraw'].includes(what)) return { error: 'Request not found.' };
  if (!(await requestsReady())) return { error: REQUESTS_MISSING };
  const r = await decideRequest(user, 'brand', id, what, String(fd.get('reply') ?? '').trim());
  if (r.ok && what !== 'withdraw') await afterResponse('sponsor-request', () => notifySponsorRequest(id, what === 'accept' ? 'accepted' : 'declined'));
  // On an error (e.g. "already answered" from a second tab) keep the card as it is so the message stays visible
  if (r.ok) revalidatePath('/sponsor', 'layout');
  return { ok: r.ok, error: r.error, message: r.message };
}

'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { clip, dateRange, festSlug, rupees, todayIST } from '@/lib/format';
import { cancelFest, refundOrder } from '@/lib/refunds';
import { OrderError } from '@/lib/orders';
import { boothCode } from '@/lib/ticket-crypto';
import { isUuid } from '@/lib/http';
import { canManage } from '@/lib/queries';
import { leadsReady } from '@/lib/sponsor-leads';
import { siteUrl } from '@/lib/env';
import { afterResponse } from '@/lib/errors';
import { notifySponsorRequest, sendEmail } from '@/lib/mail';
import {
  LIMITS, REQUESTS_MISSING, SEND_NEEDS_LIVE, createRequest, toPaise, decideRequest, parseRequestFields, requestsReady, visibleToBrands, type Decision,
} from '@/lib/sponsor-requests';
import { matchCredits, confirmManually, rejectUpiOrder as rejectUpi, newInboundToken } from '@/lib/upi';
import { parseAlerts, parseCsv, parseStatement, VPA_RE, type Credit } from '@/lib/upi-parse';
import type { MatchResult } from '@/lib/upi';
import type { ActionState } from '@/lib/types';
import { approvalRequired, changeNotice, isRenameNote, renameClearsApproval, renameNote, type RenameReview } from '@/lib/fest-form';

// ─── helpers ──────────────────────────────────────────────
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const rupeesToPaise = (v: string) => Math.round(Number(v || 0) * 100);
const first = (e: z.ZodError) => ({ error: e.issues[0].message });
/** Postgres `int` columns hold up to 2,147,483,647 — every number is checked against a friendly limit below that first. */
const MAX_CAPACITY = 1_000_000;
const MAX_TICKET_PRICE_PAISE = 10_000_00;
/** Fest's total capacity: empty = no limit; otherwise a whole number 1 … 10,00,000. */
function capacityOf(v: string | undefined): { value: number | null } | { error: string } {
  const t = (v ?? '').trim();
  if (!t || t === '0') return { value: null };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1) return { error: 'Capacity must be a whole number (or leave it empty for no limit).' };
  if (n > MAX_CAPACITY) return { error: 'Capacity can be at most 10,00,000 people.' };
  return { value: n };
}
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

/**
 * Ensures the signed-in organizer runs the fest named in the form (owner or co-organizer).
 * `ownerOnly` actions — where money goes, refunds, the team, cancelling — need the owner.
 */
async function ownFest(fd: FormData, opts: { ownerOnly?: boolean } = {}) {
  const user = await requireUser('organizer');
  const festId = s(fd, 'festId');
  if (!isUuid(festId)) throw new Error('Fest not found');
  const [f] = await sql<{ id: string; slug: string; name: string; starts_on: string; ends_on: string; is_owner: boolean }[]>`
    select f.id, f.slug, f.name, f.starts_on, f.ends_on, (f.organizer_id = ${user.id}) as is_owner
    from fests f where f.id = ${festId} and ${canManage(user)}`;
  if (!f) throw new Error('Fest not found');
  if (opts.ownerOnly && !f.is_owner) throw new OwnerOnly();
  return { user, fest: f };
}
class OwnerOnly extends Error { constructor() { super('Only the fest’s owner can do this.'); } }
const refresh = (festId: string) => revalidatePath(`/organizer/${festId}`, 'layout');

const IST_TS = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

// ─── Fest ─────────────────────────────────────────────────
const FestSchema = z.object({
  name: z.string().trim().min(3, 'Fest name is too short').max(60),
  college: z.string().trim().min(3, 'Enter the college name').max(120),
  city: z.string().trim().min(2, 'Enter the city').max(60),
  venue: z.string().trim().max(120).optional(),
  category: z.enum(['cultural', 'tech', 'sports', 'management', 'other']),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an end date'),
  description: z.string().trim().max(2000).optional(),
  emoji: z.string().trim().min(1).max(8).default('🎉'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFE034'),
  capacity: z.string().optional(),
}).refine((d) => d.ends_on >= d.starts_on, { message: 'End date must be on or after the start date' });

export async function createFest(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('organizer');
  const p = FestSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const d = p.data;
  if (d.starts_on < todayIST()) return { error: 'The start date can’t be in the past.' };
  const cap = capacityOf(d.capacity);
  if ('error' in cap) return cap;

  const tName = clip(s(fd, 'ticket_name') || 'General Entry', 60);
  const tPrice = rupeesToPaise(s(fd, 'ticket_price'));
  const tQuota = Number(s(fd, 'ticket_quota') || 500);
  if (!Number.isFinite(tPrice) || tPrice < 0 || tPrice > MAX_TICKET_PRICE_PAISE) return { error: 'Ticket price must be between ₹0 and ₹10,000' };
  if (!Number.isInteger(tQuota) || tQuota < 1 || tQuota > 100000) return { error: 'Ticket quantity must be between 1 and 100,000' };

  // Unique slug: name (any Indian script is transliterated; college/city/year if that is empty), then name-year, then name-random
  let slug = festSlug({ slug: s(fd, 'slug'), name: d.name, college: d.college, city: d.city, starts_on: d.starts_on });
  const taken = async (x: string) => (await sql`select 1 from fests where slug = ${x}`).length > 0;
  if (await taken(slug)) slug = `${slug}-${d.starts_on.slice(0, 4)}`.slice(0, 48);
  while (await taken(slug)) slug = `${slug.slice(0, 42)}-${Math.random().toString(36).slice(2, 6)}`;

  const capacity = cap.value;
  const [f] = await sql<{ id: string }[]>`
    insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity)
    values (${slug}, ${user.id}, ${d.name}, ${d.college}, ${d.city}, ${d.venue || null}, ${d.category}, ${d.starts_on}, ${d.ends_on},
            ${d.description ?? ''}, ${d.emoji}, ${d.accent}, ${capacity})
    returning id`;
  await sql`insert into ticket_types (fest_id, name, price_paise, quota) values (${f.id}, ${tName}, ${tPrice}, ${tQuota})`;
  redirect(`/organizer/${f.id}?created=1`);
}

/**
 * Saving fest details. Once tickets are sold (Harshith, Oct 23 2026: "Allow + email buyers"):
 * - changing the name, dates or venue emails every ticket holder what changed (old → new), in the background;
 * - renaming clears THE FEST's approval (see renameClearsApproval: always with tickets sold; with none sold too while
 *   RENAME_REVIEW_WITHOUT_TICKETS is on). A live fest goes to review at once; a draft or ended one goes to review
 *   on its next Publish/Reopen — so Unpublish → rename → Publish can't skip the check;
 * - the organizer must tick "I understand" first (the form shows the warning; the server checks it too);
 * - new dates may not drop lunch days that were already sold.
 */
export async function updateFest(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const p = FestSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const d = p.data;
  const cap = capacityOf(d.capacity);
  if ('error' in cap) return cap;
  const venue = d.venue || null;

  const r = await sql.begin(async (tx) => {
    const [cur] = await tx<{ name: string; starts_on: string; ends_on: string; venue: string | null; status: string; slug: string; approved: boolean; review_note: string | null }[]>`
      select name, starts_on, ends_on, venue, status::text, slug, approved_at is not null as approved, review_note
      from fests where id = ${fest.id} for update`;
    const datesChanged = cur.starts_on !== d.starts_on || cur.ends_on !== d.ends_on;
    if (cur.starts_on !== d.starts_on && d.starts_on < todayIST()) return { error: 'The new start date can’t be in the past.' } as const;
    const nameChanged = cur.name !== d.name;
    const venueChanged = (cur.venue ?? '') !== (venue ?? '');
    const holders = (nameChanged || datesChanged || venueChanged)
      ? (await tx<{ email: string }[]>`
          select distinct u.email::text as email from tickets t join users u on u.id = t.user_id
          where t.fest_id = ${fest.id} and t.status <> 'void'`).map((h) => h.email)
      : [];
    const clearApproval = nameChanged && approvalRequired() && cur.status !== 'cancelled' && renameClearsApproval(cur.approved, holders.length);
    const toReview = clearApproval && cur.status === 'live';
    // Already waiting for a re-check (renamed earlier, not approved since): renaming again only updates the note
    const recheck = nameChanged && isRenameNote(cur.review_note);
    const review: RenameReview = toReview ? 'now' : (clearApproval || recheck) && cur.status !== 'review' ? 'next' : null;
    if (holders.length && datesChanged) {
      const lost = await tx<{ name: string; d: string }[]>`
        select tt.name, d::text as d from ticket_types tt, unnest(tt.lunch_days) d
        where tt.fest_id = ${fest.id} and (d < ${d.starts_on}::date or d > ${d.ends_on}::date)
          and (tt.sold > 0 or exists (select 1 from orders o where o.ticket_type_id = tt.id and o.status = 'paid'))
        order by d`;
      if (lost.length) {
        const days = [...new Set(lost.map((l) => dateRange(l.d, l.d)))].join(', ');
        return { error: `Lunch on ${days} is already sold (${[...new Set(lost.map((l) => l.name))].join(', ')}) and would fall outside the new dates. Keep ${lost.length > 1 ? 'those days' : 'that day'} in the fest, or refund those tickets first.` } as const;
      }
    }
    // Ticket holders get emailed, or a live fest pauses sales: the organizer must say they understand. The reply carries
    // what to warn about, so the form can show the tick even if the first ticket sold while they were editing.
    if ((holders.length || toReview) && fd.get('confirm_notice') !== 'on') {
      return { error: `${changeNotice({ holders: holders.length, review })} Tick “I understand” and save again.`, confirm: { holders: holders.length, review } } as const;
    }
    await tx`update fests set name = ${d.name}, college = ${d.college}, city = ${d.city}, venue = ${venue},
              category = ${d.category}, starts_on = ${d.starts_on}, ends_on = ${d.ends_on}, description = ${d.description ?? ''},
              emoji = ${d.emoji}, accent = ${d.accent}, capacity = ${cap.value}
            where id = ${fest.id}`;
    // Renamed again while still waiting for the admin: the note keeps the original name (it is never wiped before the admin sees it)
    if (clearApproval || recheck) {
      await tx`update fests set approved_at = null, approved_by = null,
                 status = case when status = 'live' then 'review'::fest_status else status end,
                 review_note = ${renameNote(cur.name, d.name, holders.length, recheck ? cur.review_note : null)}
               where id = ${fest.id}`;
    }
    const changes = [
      nameChanged && `Name: ${cur.name} → ${d.name}`,
      datesChanged && `Dates: ${dateRange(cur.starts_on, cur.ends_on)} → ${dateRange(d.starts_on, d.ends_on)}`,
      venueChanged && `Venue: ${cur.venue || 'not set'} → ${venue || 'not set'}`,
    ].filter(Boolean) as string[];
    return { holders, changes, review, oldName: cur.name, slug: cur.slug } as const;
  });
  if ('error' in r) return { error: r.error, ...('confirm' in r ? { confirm: r.confirm } : {}) };

  if (r.holders.length) {
    const subject = `${d.name}: fest details have changed`;
    const body = [
      `The organizers of ${r.oldName} changed some details of the fest you have a ticket for:`,
      '',
      ...r.changes.map((c) => `• ${c}`),
      '',
      'Your ticket stays valid — you don’t need to do anything.',
      `See your tickets: ${siteUrl()}/tickets`,
      '',
      '— THE FEST',
    ].join('\n');
    await afterResponse('fest change emails', async () => {
      // One failed send must not stop the rest of the list
      for (const email of r.holders) {
        try { await sendEmail(email, subject, body); } catch (e) { console.error('fest change email failed', email, e); }
      }
    });
  }
  refresh(fest.id);
  revalidatePath(`/fests/${r.slug}`);
  const mailed = r.holders.length ? ` ${r.holders.length} ticket holder(s) are being emailed.` : '';
  if (r.review === 'now') return { ok: true, message: `Saved. The new name goes to THE FEST for a quick check — ticket sales pause until it’s approved.${mailed}` };
  if (r.review === 'next') return { ok: true, message: `Saved. The new name needs a quick check by THE FEST — when you publish, the fest goes to admin review first.${mailed}` };
  return { ok: true, message: r.holders.length ? `Saved. ${r.holders.length} ticket holder(s) are being emailed about the change.` : 'Saved.' };
}

export async function setFestStatus(fd: FormData) {
  const { fest } = await ownFest(fd);
  const status = s(fd, 'status');
  if (!['draft', 'live', 'ended'].includes(status)) return;
  if (status === 'live') {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from ticket_types where fest_id = ${fest.id} and active`;
    if (!n) return; // UI prevents this; nothing to sell
  }
  // New fests — and fests renamed since THE FEST approved them (updateFest clears approved_at) — are checked by
  // THE FEST before tickets go on sale. Publish, Submit and Reopen all come through here. The review-or-live choice is
  // made inside this one UPDATE, so a rename saved at the same moment can't slip past review.
  // Going to review clears an old "sent back" note, but never a rename note: the admin must see what the fest was called.
  const needs = approvalRequired();
  await sql`update fests set
              status = (case when ${status} = 'live' and approved_at is null and ${needs} then 'review' else ${status} end)::fest_status,
              review_note = case when ${status} = 'live' and approved_at is null and ${needs}
                                  and coalesce(review_note, '') not like ${'Renamed from “%'} then null else review_note end
            where id = ${fest.id} and status <> 'cancelled'`; // cancelled fests stay cancelled
  refresh(fest.id);
}

// ─── Ticket types ─────────────────────────────────────────
const TicketSchema = z.object({
  name: z.string().trim().min(2, 'Name the ticket').max(60),
  description: z.string().trim().max(200).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a price in rupees (0 for free)'),
  quota: z.coerce.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(100000),
});

/** Lunch days, stay and add-on from the ticket-type form. Lunch days must fall within the fest's dates. */
function perksFrom(fd: FormData, fest: { starts_on: string; ends_on: string }) {
  const days = [...new Set(fd.getAll('lunch_days').map(String))].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (days.some((d) => d < fest.starts_on || d > fest.ends_on)) return { error: 'Lunch days must be during the fest.' } as const;
  return { days: `{${days.join(',')}}`, stay: fd.get('includes_stay') === 'on', kind: fd.get('addon') === 'on' ? 'addon' : 'entry' } as const;
}

export async function addTicketType(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const p = TicketSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const price = rupeesToPaise(p.data.price);
  if (price > MAX_TICKET_PRICE_PAISE) return { error: 'Max ticket price is ₹10,000' };
  const perks = perksFrom(fd, fest);
  if ('error' in perks) return { error: perks.error };
  if (perks.kind === 'addon' && perks.days === '{}' && !perks.stay) return { error: 'An add-on needs lunch days or stay.' };
  await sql`insert into ticket_types (fest_id, name, description, price_paise, quota, sort, kind, lunch_days, includes_stay)
            values (${fest.id}, ${p.data.name}, ${p.data.description ?? ''}, ${price}, ${p.data.quota},
                    (select coalesce(max(sort), 0) + 1 from ticket_types where fest_id = ${fest.id}),
                    ${perks.kind}, ${perks.days}::date[], ${perks.stay})`;
  refresh(fest.id);
  return { ok: true, message: 'Ticket type added.' };
}

export async function updateTicketType(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const p = TicketSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const id = s(fd, 'id');
  const [t] = await sql<{ sold: number; kind: string; orders: number }[]>`
    select sold, kind, (select count(*) from orders o where o.ticket_type_id = tt.id)::int as orders
    from ticket_types tt where id = ${id} and fest_id = ${fest.id}`;
  if (!t) return { error: 'Ticket type not found' };
  if (p.data.quota < t.sold) return { error: `Already ${t.sold} sold — quantity can't go below that.` };
  const perks = perksFrom(fd, fest);
  if ('error' in perks) return { error: perks.error };
  // Entry ↔ add-on can't flip once anyone has ordered it (tickets vs. no tickets)
  if (perks.kind !== t.kind && t.orders > 0) return { error: 'People have already ordered this — it can’t switch between ticket and add-on.' };
  if (perks.kind === 'addon' && perks.days === '{}' && !perks.stay) return { error: 'An add-on needs lunch days or stay.' };
  const price = rupeesToPaise(p.data.price);
  if (price > MAX_TICKET_PRICE_PAISE) return { error: 'Max ticket price is ₹10,000' };
  await sql`update ticket_types set name = ${p.data.name}, description = ${p.data.description ?? ''},
              price_paise = ${price}, quota = ${p.data.quota},
              kind = ${perks.kind}, lunch_days = ${perks.days}::date[], includes_stay = ${perks.stay} where id = ${id}`;
  refresh(fest.id);
  return { ok: true, message: 'Updated.' };
}

export async function toggleTicketType(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`update ticket_types set active = not active where id = ${s(fd, 'id')} and fest_id = ${fest.id}`;
  refresh(fest.id);
}

// ─── Schedule ─────────────────────────────────────────────
export async function addEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const title = s(fd, 'title'), venue = s(fd, 'venue'), date = s(fd, 'date'), start = s(fd, 'start'), end = s(fd, 'end');
  if (title.length < 2) return { error: 'Enter an event title' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { error: 'Pick a date, start and end time' };
  if (date < fest.starts_on || date > fest.ends_on) return { error: 'Date must be within the fest dates' };
  const a = IST_TS(date, start);
  let b = IST_TS(date, end);
  if (b <= a) b = new Date(b.getTime() + 864e5); // ends after midnight
  await sql`insert into schedule_events (fest_id, title, venue, category, starts_at, ends_at)
            values (${fest.id}, ${clip(title, 120)}, ${clip(venue, 120)}, ${s(fd, 'category') || 'event'}, ${a}, ${b})`;
  refresh(fest.id);
  return { ok: true, message: 'Added to schedule.' };
}

export async function deleteEvent(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`delete from schedule_events where id = ${s(fd, 'id')} and fest_id = ${fest.id}`;
  refresh(fest.id);
}

// ─── Volunteers ───────────────────────────────────────────
export async function addStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const email = s(fd, 'email').toLowerCase();
  const name = s(fd, 'name');
  if (!z.string().email().safeParse(email).success) return { error: 'Enter a valid email' };
  if (name.length < 2) return { error: 'Enter the volunteer’s name' };
  const duty = s(fd, 'duty') || 'Gate 1';
  const canScan = fd.get('can_scan') === 'on';
  const r = await sql`insert into fest_staff (fest_id, email, name, duty, can_scan)
                      values (${fest.id}, ${email}, ${clip(name, 80)}, ${clip(duty, 60)}, ${canScan})
                      on conflict (fest_id, email) do nothing returning id`;
  if (!r.length) return { error: 'That email is already on your team' };
  refresh(fest.id);
  return { ok: true, message: `${name} added. They log in to the scanner with ${email}.` };
}

export async function toggleStaffCheckin(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`update fest_staff set checked_in_at = case when checked_in_at is null then now() else null end
            where id = ${s(fd, 'id')} and fest_id = ${fest.id}`;
  refresh(fest.id);
}

export async function removeStaff(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`delete from fest_staff where id = ${s(fd, 'id')} and fest_id = ${fest.id}`;
  refresh(fest.id);
}

/**
 * "Phone lost? Reset scanner keys": new ticket QRs seal under a new key epoch, and every scanner of this fest
 * (volunteers, co-organizers, owner) must log in again. QRs from the previous epoch still open on the new keys;
 * older ones need the network. Owner or co-organizer.
 */
export async function resetScannerKeys(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  await sql.begin(async (tx) => {
    await tx`update fests set qr_epoch = qr_epoch % 255 + 1 where id = ${fest.id}`;
    await tx`delete from sessions s using users u where s.user_id = u.id and s.kind = 'scanner' and (
               u.email in (select email from fest_staff where fest_id = ${fest.id})
               or u.email in (select email from fest_members where fest_id = ${fest.id})
               or u.id = (select organizer_id from fests where id = ${fest.id}))`;
  });
  refresh(fest.id);
  return { ok: true, message: 'Scanner keys reset. Everyone scanning for this fest must log in to the scanner again.' };
}

// ─── Announcements ────────────────────────────────────────
export async function postAnnouncement(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const title = s(fd, 'title');
  if (title.length < 3) return { error: 'Write a short headline' };
  await sql`insert into announcements (fest_id, title, body, urgent)
            values (${fest.id}, ${clip(title, 120)}, ${clip(s(fd, 'body'), 1000)}, ${fd.get('urgent') === 'on'})`;
  refresh(fest.id);
  revalidatePath(`/fests/${fest.slug}`);
  return { ok: true, message: 'Posted — it’s live on your fest page.' };
}

export async function deleteAnnouncement(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`delete from announcements where id = ${s(fd, 'id')} and fest_id = ${fest.id}`;
  refresh(fest.id);
}

// ─── Sponsors ─────────────────────────────────────────────
export async function addSponsor(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const brand = s(fd, 'brand');
  const email = s(fd, 'email').toLowerCase();
  if (brand.length < 2) return { error: 'Enter the brand name' };
  if (!z.string().email().safeParse(email).success) return { error: 'Enter the sponsor’s email' };
  const tier = s(fd, 'tier') || 'Associate';
  const rawAmount = s(fd, 'amount');
  const amount = toPaise(rawAmount);
  if (rawAmount.startsWith('-')) return { error: 'The deal amount can’t be negative.' };
  if (!Number.isFinite(amount)) return { error: 'Enter the deal amount in rupees, like 50000 or 12345.50.' };
  if (amount > LIMITS.amountMaxPaise) return { error: 'The deal amount can be at most ₹1 crore.' };
  try {
    await sql`insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code)
              values (${fest.id}, ${email}, ${clip(brand, 80)}, ${clip(tier, 40)}, ${amount}, ${boothCode()})`;
  } catch (e) {
    if (isUniqueViolation(e)) return { error: 'This sponsor is already added' };
    throw e;
  }
  refresh(fest.id);
  return { ok: true, message: `${brand} added. They sign up as a Sponsor with ${email} to see live numbers.` };
}

export async function removeSponsor(fd: FormData) {
  const { fest } = await ownFest(fd);
  const id = s(fd, 'id');
  if (!isUuid(id)) redirect(`/organizer/${fest.id}/sponsors`);
  // Students who shared with this brand must keep their "Stop sharing" button, and the brand must keep seeing
  // withdrawals — so a sponsor with any leads (active or withdrawn) can't be deleted.
  if (await leadsReady()) {
    // One statement, so a lead saved between a check and the delete can't be swept away with the sponsor
    const gone = await sql`
      delete from sponsors sp where sp.id = ${id} and sp.fest_id = ${fest.id}
        and not exists (select 1 from sponsor_leads l where l.sponsor_id = sp.id)
      returning sp.id`;
    if (!gone.length) {
      const [lead] = await sql`select 1 from sponsor_leads where sponsor_id = ${id} limit 1`;
      if (lead) redirect(`/organizer/${fest.id}/sponsors?err=leads`);
    }
  } else {
    await sql`delete from sponsors where id = ${id} and fest_id = ${fest.id}`;
  }
  refresh(fest.id);
  redirect(`/organizer/${fest.id}/sponsors?removed=1`);
}

// ─── Sponsorship requests (v2.6) — owner and co-organizers, same rule as addSponsor ───
export async function setOpenToSponsors(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  if (!(await requestsReady())) return { error: REQUESTS_MISSING };
  const open = fd.get('open') === 'on';
  await sql`update fests set open_to_sponsors = ${open} where id = ${fest.id}`;
  refresh(fest.id);
  return { ok: true, message: open ? 'Brands can now find this fest and see its media kit.' : 'Hidden from brands.' };
}

export async function sendBrandRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, fest } = await ownFest(fd);
  if (!(await requestsReady())) return { error: REQUESTS_MISSING };
  const brandUserId = s(fd, 'brandUserId');
  if (!isUuid(brandUserId)) return { error: 'Brand not found.' };
  if (!user.verified) return { error: 'Confirm your email first.' };
  // Only fests THE FEST approved (live) and shown to brands can pitch — the brand can then open the fest's media kit.
  const [f] = await sql<{ visible: boolean }[]>`select ${visibleToBrands()} as visible from fests f where f.id = ${fest.id}`;
  if (!f?.visible) return { error: SEND_NEEDS_LIVE };
  const [b] = await sql<{ brand: string }[]>`
    select p.brand from brand_profiles p join users u on u.id = p.user_id where p.user_id = ${brandUserId} and p.listed and u.role = 'sponsor'`;
  if (!b) return { error: 'This brand is not taking requests right now.' };
  const fields = parseRequestFields(fd);
  if ('error' in fields) return fields;
  const r = await createRequest({ festId: fest.id, brandUserId, brand: b.brand, direction: 'org_to_brand', sentBy: user.id, fields });
  if (r.error) return { error: r.error };
  await afterResponse('sponsor-request', () => notifySponsorRequest(r.id!, 'new'));
  refresh(fest.id);
  return { ok: true, message: `Request sent to ${b.brand}. You\u2019ll get an email when they answer.` };
}

/** Accept, decline or withdraw — as the fest. Who may do what is checked in decideRequest. */
export async function orgDecide(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, fest } = await ownFest(fd);
  const id = s(fd, 'id');
  const what = s(fd, 'do') as Decision;
  if (!isUuid(id) || !['accept', 'decline', 'withdraw'].includes(what)) return { error: 'Request not found.' };
  if (!(await requestsReady())) return { error: REQUESTS_MISSING };
  const r = await decideRequest(user, 'org', id, what, s(fd, 'reply'));
  if (r.ok && what !== 'withdraw') await afterResponse('sponsor-request', () => notifySponsorRequest(id, what === 'accept' ? 'accepted' : 'declined'));
  // On an error (e.g. "already answered" from a second tab) keep the card as it is so the message stays visible
  if (r.ok) refresh(r.festId ?? fest.id);
  return { ok: r.ok, error: r.error, message: r.message };
}

// ─── Payments: zero-fee bank UPI ──────────────────────────

export type PaymentsState = (ActionState & { result?: MatchResult }) | null;

export async function saveUpiSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd, { ownerOnly: true });
  const enabled = fd.get('upi_enabled') === 'on';
  const vpa = s(fd, 'upi_vpa');
  const name = clip(s(fd, 'upi_name'), 60);
  if (enabled && !VPA_RE.test(vpa)) return { error: 'Enter the fest’s UPI ID, like neonutsav@icici' };
  await sql`update fests set upi_enabled = ${enabled}, upi_vpa = ${vpa || null}, upi_name = ${name || null} where id = ${fest.id}`;
  refresh(fest.id);
  return { ok: true, message: enabled ? 'Zero-fee UPI is on. Students can now pay the fest directly.' : 'Saved.' };
}

const summary = (r: MatchResult) =>
  `${r.matched.length} confirmed · ${r.flagged.length} need a look · ${r.unmatched.length} not matched yet${r.duplicates ? ` · ${r.duplicates} already seen` : ''}`;

export async function pasteAlerts(_: PaymentsState, fd: FormData): Promise<PaymentsState> {
  const { fest } = await ownFest(fd);
  const text = s(fd, 'alerts').slice(0, 200_000);
  const credits = parseAlerts(text);
  if (!credits.length) return { error: 'No credit alerts found. Paste the bank SMS or email text that says an amount was credited.' };
  const r = await matchCredits(fest.id, credits, 'paste');
  refresh(fest.id);
  return { ok: true, message: summary(r), result: r };
}

export async function uploadStatement(_: PaymentsState, fd: FormData): Promise<PaymentsState> {
  const { fest } = await ownFest(fd);
  const file = fd.get('statement');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose your bank statement file (CSV or Excel .xlsx).' };
  if (file.size > 5 * 1024 * 1024) return { error: 'File is too big (max 5 MB). Download a shorter date range.' };
  const name = file.name.toLowerCase();
  let rows: (string | number | null)[][];
  try {
    if (name.endsWith('.xlsx')) {
      const readXlsx = (await import('read-excel-file/node')).default;
      const sheets = await readXlsx(Buffer.from(await file.arrayBuffer()));
      // Use the first sheet that looks like a statement
      const toRows = (d: unknown[][]) => d.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : (c as string | number | null))));
      rows = toRows((sheets.find((sh) => !parseStatement(toRows(sh.data as unknown[][])).error) ?? sheets[0]).data as unknown[][]);
    } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
      rows = parseCsv(await file.text());
    } else {
      return { error: 'Use CSV or .xlsx. For an old .xls file, open it and “Save as” CSV.' };
    }
  } catch {
    return { error: 'Couldn’t read that file. Try downloading the statement as CSV.' };
  }
  const { credits, error } = parseStatement(rows);
  if (error) return { error };
  if (!credits.length) return { error: 'No credits found in this statement.' };
  const r = await matchCredits(fest.id, credits as Credit[], 'statement');
  refresh(fest.id);
  return { ok: true, message: `${credits.length} credits read · ${summary(r)}`, result: r };
}

const ALREADY_HANDLED = 'Order not found or already handled.';
/** A second tab / co-organizer got there first: show a calm note on a fresh list instead of an error page. */
const handledElsewhere = (festId: string) => {
  refresh(festId);
  redirect(`/organizer/${festId}/payments?handled=1`);
};

export async function confirmUpiOrder(fd: FormData) {
  const { fest } = await ownFest(fd);
  if (!isUuid(s(fd, 'orderId'))) return;
  let handled = false;
  try { await confirmManually(s(fd, 'orderId'), fest.id); }
  catch (e) {
    if (!(e instanceof OrderError)) throw e; /* other OrderErrors are flagged on the order (e.g. refund needed) */
    handled = e.message === ALREADY_HANDLED;
  }
  if (handled) handledElsewhere(fest.id);
  refresh(fest.id);
}

export async function rejectUpiOrder(fd: FormData) {
  const { fest } = await ownFest(fd);
  if (!isUuid(s(fd, 'orderId'))) return;
  let handled = false;
  try { await rejectUpi(s(fd, 'orderId'), fest.id, s(fd, 'note') || 'No matching payment in the bank account'); }
  catch (e) {
    if (!(e instanceof OrderError)) throw e;
    handled = true;
  }
  if (handled) handledElsewhere(fest.id);
  refresh(fest.id);
}

export async function rotateInboundToken(fd: FormData) {
  const { fest } = await ownFest(fd, { ownerOnly: true });
  await sql`update fests set inbound_token = ${newInboundToken()} where id = ${fest.id}`;
  refresh(fest.id);
}

// ─── Refunds & cancellation ───────────────────────────────

export async function refundOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd, { ownerOnly: true });
  if (!isUuid(s(fd, 'orderId'))) return { error: 'Order not found.' };
  const reason = s(fd, 'reason');
  const n = Number(s(fd, 'tickets') || 0);
  if (reason.length < 3) return { error: 'Add a short reason — the student sees it.' };
  if (!Number.isInteger(n) || n < 1) return { error: 'Choose how many tickets to cancel.' };
  try {
    const r = await refundOrder(s(fd, 'orderId'), { festId: fest.id, tickets: n, reason });
    refresh(fest.id);
    const plus = r.addons ? ` Its lunch/stay add-on${r.addons > 1 ? 's were' : ' was'} refunded too.` : '';
    if (r.provider === 'upi_direct') return { ok: true, message: `${r.k} ticket(s) cancelled.${plus} Send ${rupees(r.amount)} back to the student by UPI, then mark it sent.` };
    if (!r.gatewayOk) return { ok: true, message: `${r.k} ticket(s) cancelled, but the gateway refund failed. THE FEST has been alerted to retry.${plus}` };
    return { ok: true, message: `${r.k} ticket(s) cancelled${r.amount ? ` and ${rupees(r.amount)} refunded` : ''}.${plus}` };
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
}

export async function markUpiRefundSent(fd: FormData) {
  const { fest } = await ownFest(fd, { ownerOnly: true });
  if (!isUuid(s(fd, 'orderId'))) return;
  await sql`update orders set refund_status = 'done' where id = ${s(fd, 'orderId')} and fest_id = ${fest.id} and refund_status = 'manual_pending'`;
  refresh(fest.id);
}

export async function cancelFestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd, { ownerOnly: true });
  const reason = s(fd, 'reason');
  if (reason.length < 5) return { error: 'Tell students why the fest is cancelled.' };
  if (s(fd, 'confirm') !== 'CANCEL') return { error: 'Type CANCEL to confirm. This refunds every ticket and can’t be undone.' };
  const r = await cancelFest(fest.id, reason);
  refresh(fest.id);
  revalidatePath(`/fests/${fest.slug}`);
  return { ok: true, message: `Fest cancelled. ${r.refunded} order(s) refunded${r.failed ? `, ${r.failed} gateway refund(s) failed (THE FEST will retry)` : ''}${r.skipped ? `, ${r.skipped} skipped (tickets already used)` : ''}.` };
}

// ─── Co-organizers ────────────────────────────────────────

export async function addMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, fest } = await ownFest(fd, { ownerOnly: true });
  const email = s(fd, 'email').toLowerCase();
  if (!z.string().email().safeParse(email).success) return { error: 'Enter a valid email' };
  if (email === user.email.toLowerCase()) return { error: 'You already own this fest.' };
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from fest_members where fest_id = ${fest.id}`;
  if (n >= 10) return { error: 'A fest can have up to 10 co-organizers.' };
  const r = await sql`insert into fest_members (fest_id, email, added_by) values (${fest.id}, ${email}, ${user.id})
                      on conflict (fest_id, email) do nothing returning id`;
  if (!r.length) return { error: 'That email is already a co-organizer.' };
  const [acct] = await sql<{ role: string }[]>`select role from users where email = ${email}`;
  await afterResponse('co-organizer email', () => sendEmail(email, `You’re now a co-organizer of ${fest.name}`, [
    `${user.name} added you as a co-organizer of ${fest.name} on THE FEST.`,
    '',
    acct?.role === 'organizer'
      ? `Log in to manage it: ${siteUrl()}/login?next=/organizer/${fest.id}`
      : `Create an organizer account with this email to get access: ${siteUrl()}/signup?role=organizer`,
    '',
    '— THE FEST',
  ].join('\n')));
  refresh(fest.id);
  return {
    ok: true,
    message: acct?.role === 'organizer' ? `${email} can now manage this fest.`
      : acct ? `Added — but ${email} has a ${acct.role} account. They need an organizer account with this email to get in.`
      : `Added. We’ve emailed ${email} to create an organizer account.`,
  };
}

/** The owner can remove anyone; a co-organizer can remove themselves (leave). */
export async function removeMember(fd: FormData) {
  const { user, fest } = await ownFest(fd);
  const id = s(fd, 'id');
  if (!isUuid(id)) return;
  if (fest.is_owner) await sql`delete from fest_members where id = ${id} and fest_id = ${fest.id}`;
  else await sql`delete from fest_members where id = ${id} and fest_id = ${fest.id} and email = ${user.email}`;
  refresh(fest.id);
  if (!fest.is_owner) redirect('/organizer');
}

export async function setAllowTransfers(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`update fests set allow_transfers = ${fd.get('allow') === '1'} where id = ${fest.id}`;
  refresh(fest.id);
}

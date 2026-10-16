'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { rupees, slugify } from '@/lib/format';
import { cancelFest, refundOrder } from '@/lib/refunds';
import { OrderError } from '@/lib/orders';
import { boothCode } from '@/lib/ticket-crypto';
import { isUuid } from '@/lib/http';
import { canManage } from '@/lib/queries';
import { sendEmail } from '@/lib/mail';
import { matchCredits, confirmManually, rejectUpiOrder as rejectUpi, newInboundToken } from '@/lib/upi';
import { parseAlerts, parseCsv, parseStatement, VPA_RE, type Credit } from '@/lib/upi-parse';
import type { MatchResult } from '@/lib/upi';
import type { ActionState } from '@/lib/types';

// ─── helpers ──────────────────────────────────────────────
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const rupeesToPaise = (v: string) => Math.round(Number(v || 0) * 100);
const first = (e: z.ZodError) => ({ error: e.issues[0].message });

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

  const tName = s(fd, 'ticket_name') || 'General Entry';
  const tPrice = rupeesToPaise(s(fd, 'ticket_price'));
  const tQuota = Number(s(fd, 'ticket_quota') || 500);
  if (tPrice < 0 || tPrice > 10_000_00) return { error: 'Ticket price must be between ₹0 and ₹10,000' };
  if (!Number.isInteger(tQuota) || tQuota < 1 || tQuota > 100000) return { error: 'Ticket quantity must be between 1 and 100,000' };

  // Unique slug: name, then name-year, then name-random
  let slug = slugify(s(fd, 'slug') || d.name);
  if (slug.length < 3) slug = `${slug}-fest`;
  const taken = async (x: string) => (await sql`select 1 from fests where slug = ${x}`).length > 0;
  if (await taken(slug)) slug = `${slug}-${d.starts_on.slice(0, 4)}`.slice(0, 48);
  while (await taken(slug)) slug = `${slug.slice(0, 42)}-${Math.random().toString(36).slice(2, 6)}`;

  const capacity = d.capacity ? Number(d.capacity) : null;
  const [f] = await sql<{ id: string }[]>`
    insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity)
    values (${slug}, ${user.id}, ${d.name}, ${d.college}, ${d.city}, ${d.venue || null}, ${d.category}, ${d.starts_on}, ${d.ends_on},
            ${d.description ?? ''}, ${d.emoji}, ${d.accent}, ${capacity && capacity > 0 ? capacity : null})
    returning id`;
  await sql`insert into ticket_types (fest_id, name, price_paise, quota) values (${f.id}, ${tName}, ${tPrice}, ${tQuota})`;
  redirect(`/organizer/${f.id}?created=1`);
}

export async function updateFest(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const p = FestSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const d = p.data;
  const capacity = d.capacity ? Number(d.capacity) : null;
  await sql`update fests set name = ${d.name}, college = ${d.college}, city = ${d.city}, venue = ${d.venue || null},
              category = ${d.category}, starts_on = ${d.starts_on}, ends_on = ${d.ends_on}, description = ${d.description ?? ''},
              emoji = ${d.emoji}, accent = ${d.accent}, capacity = ${capacity && capacity > 0 ? capacity : null}
            where id = ${fest.id}`;
  refresh(fest.id);
  return { ok: true, message: 'Saved.' };
}

export async function setFestStatus(fd: FormData) {
  const { fest } = await ownFest(fd);
  const status = s(fd, 'status');
  if (!['draft', 'live', 'ended'].includes(status)) return;
  const [cur] = await sql<{ status: string; approved_at: Date | null }[]>`select status, approved_at from fests where id = ${fest.id}`;
  if (cur.status === 'cancelled') return; // cancelled fests stay cancelled
  let next = status;
  if (status === 'live') {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from ticket_types where fest_id = ${fest.id} and active`;
    if (!n) return; // UI prevents this; nothing to sell
    // New fests are checked by THE FEST before tickets go on sale (stops fake fests taking students' money)
    if (!cur.approved_at && process.env.REQUIRE_FEST_APPROVAL !== 'false') next = 'review';
  }
  await sql`update fests set status = ${next}::fest_status, review_note = case when ${next} = 'review' then null else review_note end where id = ${fest.id}`;
  refresh(fest.id);
}

// ─── Ticket types ─────────────────────────────────────────
const TicketSchema = z.object({
  name: z.string().trim().min(2, 'Name the ticket').max(60),
  description: z.string().trim().max(200).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a price in rupees (0 for free)'),
  quota: z.coerce.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(100000),
});

export async function addTicketType(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const p = TicketSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const price = rupeesToPaise(p.data.price);
  if (price > 10_000_00) return { error: 'Max ticket price is ₹10,000' };
  await sql`insert into ticket_types (fest_id, name, description, price_paise, quota, sort)
            values (${fest.id}, ${p.data.name}, ${p.data.description ?? ''}, ${price}, ${p.data.quota},
                    (select coalesce(max(sort), 0) + 1 from ticket_types where fest_id = ${fest.id}))`;
  refresh(fest.id);
  return { ok: true, message: 'Ticket type added.' };
}

export async function updateTicketType(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const p = TicketSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return first(p.error);
  const id = s(fd, 'id');
  const [t] = await sql<{ sold: number }[]>`select sold from ticket_types where id = ${id} and fest_id = ${fest.id}`;
  if (!t) return { error: 'Ticket type not found' };
  if (p.data.quota < t.sold) return { error: `Already ${t.sold} sold — quantity can't go below that.` };
  const price = rupeesToPaise(p.data.price);
  await sql`update ticket_types set name = ${p.data.name}, description = ${p.data.description ?? ''},
              price_paise = ${price}, quota = ${p.data.quota} where id = ${id}`;
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
            values (${fest.id}, ${title.slice(0, 120)}, ${venue.slice(0, 120)}, ${s(fd, 'category') || 'event'}, ${a}, ${b})`;
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
                      values (${fest.id}, ${email}, ${name.slice(0, 80)}, ${duty.slice(0, 60)}, ${canScan})
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

// ─── Announcements ────────────────────────────────────────
export async function postAnnouncement(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd);
  const title = s(fd, 'title');
  if (title.length < 3) return { error: 'Write a short headline' };
  await sql`insert into announcements (fest_id, title, body, urgent)
            values (${fest.id}, ${title.slice(0, 120)}, ${s(fd, 'body').slice(0, 1000)}, ${fd.get('urgent') === 'on'})`;
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
  const amount = rupeesToPaise(s(fd, 'amount'));
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter the deal amount in rupees' };
  try {
    await sql`insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code)
              values (${fest.id}, ${email}, ${brand.slice(0, 80)}, ${tier.slice(0, 40)}, ${amount}, ${boothCode()})`;
  } catch {
    return { error: 'This sponsor is already added' };
  }
  refresh(fest.id);
  return { ok: true, message: `${brand} added. They sign up as a Sponsor with ${email} to see live numbers.` };
}

export async function removeSponsor(fd: FormData) {
  const { fest } = await ownFest(fd);
  await sql`delete from sponsors where id = ${s(fd, 'id')} and fest_id = ${fest.id}`;
  refresh(fest.id);
}

// ─── Payments: zero-fee bank UPI ──────────────────────────

export type PaymentsState = (ActionState & { result?: MatchResult }) | null;

export async function saveUpiSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const { fest } = await ownFest(fd, { ownerOnly: true });
  const enabled = fd.get('upi_enabled') === 'on';
  const vpa = s(fd, 'upi_vpa');
  const name = s(fd, 'upi_name').slice(0, 60);
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

export async function confirmUpiOrder(fd: FormData) {
  const { fest } = await ownFest(fd);
  if (!isUuid(s(fd, 'orderId'))) return;
  try { await confirmManually(s(fd, 'orderId'), fest.id); }
  catch (e) { if (!(e instanceof OrderError)) throw e; /* flagged on the order (e.g. refund needed) */ }
  refresh(fest.id);
}

export async function rejectUpiOrder(fd: FormData) {
  const { fest } = await ownFest(fd);
  if (!isUuid(s(fd, 'orderId'))) return;
  await rejectUpi(s(fd, 'orderId'), fest.id, s(fd, 'note') || 'No matching payment in the bank account');
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
    if (r.provider === 'upi_direct') return { ok: true, message: `${r.k} ticket(s) cancelled. Send ${rupees(r.amount)} back to the student by UPI, then mark it sent.` };
    if (!r.gatewayOk) return { ok: true, message: `${r.k} ticket(s) cancelled, but the gateway refund failed. THE FEST has been alerted to retry.` };
    return { ok: true, message: `${r.k} ticket(s) cancelled${r.amount ? ` and ${rupees(r.amount)} refunded` : ''}.` };
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
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  await sendEmail(email, `You’re now a co-organizer of ${fest.name}`, [
    `${user.name} added you as a co-organizer of ${fest.name} on THE FEST.`,
    '',
    acct?.role === 'organizer'
      ? `Log in to manage it: ${site}/login?next=/organizer/${fest.id}`
      : `Create an organizer account with this email to get access: ${site}/signup?role=organizer`,
    '',
    '— THE FEST',
  ].join('\n'));
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

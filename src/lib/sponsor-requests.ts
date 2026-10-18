import 'server-only';
import { sql } from './db';
import { festAnalytics } from './analytics';
import { canManage } from './queries';
import { groupColleges } from './sponsor-leads';
import { boothCode } from './ticket-crypto';
import { todayIST } from './format';
import type { ActionState, User } from './types';

/*
 * Two-way sponsorship requests (v2.6). Organizers pitch listed brands; brands ask to sponsor fests that switched on
 * "Show this fest to brands". Accepting creates the normal sponsors row, so the sponsor portal, booth QR, leads and
 * report work as before. Neither side sees the other's email or phone until a request is accepted.
 */

export const BRAND_CATEGORIES: Record<string, string> = {
  food: 'Food & beverage', tech: 'Tech', edtech: 'Edtech', fashion: 'Fashion', finance: 'Finance', telecom: 'Telecom', other: 'Other',
};
export const REQUEST_TIERS = ['Title', 'Powered by', 'Associate', 'Partner'] as const;
export const LIMITS = {
  brandPerDay: 10, festPerDay: 20, declineCoolDays: 7, amountMaxPaise: 1_00_00_000_00,
  brand: 80, about: 300, cities: 5, city: 40, deliverables: 600, message: 1000, reply: 300,
};
/** Shown to organizers and brands on a database without v2.6. Admins see the missing tables on /api/health. */
export const REQUESTS_MISSING = 'Sponsorship requests are not switched on yet. Please try again later.';

let ready = false;
/** Is v2.6 (brand_profiles, sponsor_requests, fests.open_to_sponsors) in this database? Only "yes" is cached. */
export async function requestsReady(): Promise<boolean> {
  if (ready) return true;
  const [r] = await sql<{ ok: boolean }[]>`
    select to_regclass('public.sponsor_requests') is not null and to_regclass('public.brand_profiles') is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'fests' and column_name = 'open_to_sponsors') as ok`;
  ready = !!r?.ok;
  return ready;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
/** Rupees text → paise, exact to the paisa ("12345.50" → 1234550). NaN when it isn't a plain amount. */
export function toPaise(v: string): number {
  const t = v.replace(/[,\s₹]/g, '');
  if (t === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const [r, p = ''] = t.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

export type RequestFields = { tier: string; amount: number; deliverables: string; message: string };
export function parseRequestFields(fd: FormData): RequestFields | { error: string } {
  const tier = str(fd, 'tier');
  if (!(REQUEST_TIERS as readonly string[]).includes(tier)) return { error: 'Pick a tier.' };
  const amount = toPaise(str(fd, 'amount'));
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter the amount in rupees, like 50000 or 12345.50.' };
  if (amount > LIMITS.amountMaxPaise) return { error: 'The amount can be at most ₹1 crore.' };
  const deliverables = str(fd, 'deliverables');
  const message = str(fd, 'message');
  if (deliverables.length > LIMITS.deliverables) return { error: `Keep "what you offer / want" to ${LIMITS.deliverables} characters.` };
  if (message.length > LIMITS.message) return { error: `Keep the message to ${LIMITS.message} characters.` };
  return { tier, amount, deliverables, message };
}

/** SQL condition: the fest can still take a sponsor — approved and live, last day not passed. Alias `f`. */
export const festOpen = () => sql`(f.status = 'live' and f.ends_on >= ${todayIST()})`;

/** SQL condition: this brand user already sponsors this fest (a sponsors row with the brand's account email). */
export const alreadySponsor = (festId: string, brandUserId: string) => sql`exists (
  select 1 from sponsors s join users u on u.email = s.email where s.fest_id = ${festId} and u.id = ${brandUserId})`;
export const SEND_NEEDS_LIVE = 'Requests can be sent once THE FEST has approved your fest (it is live) and “Show this fest to brands” is on.';
export const ALREADY_SPONSOR = 'Already a sponsor of this fest.';

/** Fests brands may see: live, opted in, not ended. Alias `f`. */
export const visibleToBrands = () => sql`(f.status = 'live' and f.open_to_sponsors and f.ends_on >= ${todayIST()})`;

/**
 * Creates one request. Serialised per sender (advisory lock) so the 24-hour caps can't be overshot by parallel posts.
 * Callers have already checked who is sending and that the fest/brand may be reached.
 */
export async function createRequest(p: {
  festId: string; brandUserId: string; brand: string; direction: 'org_to_brand' | 'brand_to_org'; sentBy: string; fields: RequestFields;
}): Promise<{ id?: string; error?: string }> {
  const byBrand = p.direction === 'brand_to_org';
  try {
    return await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${byBrand ? `sreq:b:${p.brandUserId}` : `sreq:f:${p.festId}`}))`;
      const [c] = await tx<{ recent: number; open: boolean; cooling: boolean; sponsoring: boolean }[]>`
        select ${alreadySponsor(p.festId, p.brandUserId)} as sponsoring,
          (select count(*) from sponsor_requests where direction = ${p.direction}
             and ${byBrand ? tx`brand_user_id = ${p.brandUserId}` : tx`fest_id = ${p.festId}`}
             and created_at > now() - interval '24 hours')::int as recent,
          exists (select 1 from sponsor_requests where fest_id = ${p.festId} and brand_user_id = ${p.brandUserId} and status = 'sent') as open,
          exists (select 1 from sponsor_requests where fest_id = ${p.festId} and brand_user_id = ${p.brandUserId}
                    and direction = ${p.direction} and status = 'declined'
                    and decided_at > now() - interval '7 days') as cooling`;
      if (c.sponsoring) return { error: ALREADY_SPONSOR };
      if (c.open) return { error: 'There is already an open request between this fest and this brand. Wait for an answer, or withdraw it first.' };
      if (c.cooling) return { error: `This was declined in the last ${LIMITS.declineCoolDays} days. You can send a new request after that.` };
      if (byBrand && c.recent >= LIMITS.brandPerDay) return { error: `You can send up to ${LIMITS.brandPerDay} requests a day. Try again tomorrow.` };
      if (!byBrand && c.recent >= LIMITS.festPerDay) return { error: `A fest can send up to ${LIMITS.festPerDay} requests a day. Try again tomorrow.` };
      const [r] = await tx<{ id: string }[]>`
        insert into sponsor_requests (fest_id, brand_user_id, direction, brand, tier, amount_paise, deliverables, message, sent_by)
        values (${p.festId}, ${p.brandUserId}, ${p.direction}, ${p.brand}, ${p.fields.tier}, ${p.fields.amount},
                ${p.fields.deliverables || null}, ${p.fields.message || null}, ${p.sentBy})
        returning id`;
      return { id: r.id };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { error: 'There is already an open request between this fest and this brand.' };
    throw e;
  }
}

export type Side = 'brand' | 'org';
export type Decision = 'accept' | 'decline' | 'withdraw';

/**
 * Accept / decline / withdraw. Only the receiving side may accept or decline; only the sending side may withdraw.
 * Accept is one transaction: the `status = 'sent'` guard on the update locks the row, so a double-click or a second
 * tab gets "already answered" and only one sponsors row is ever made.
 */
export async function decideRequest(user: User, side: Side, id: string, what: Decision, reply = ''):
  Promise<ActionState & { festId?: string; sponsorId?: string }> {
  const [r] = await sql<{ id: string; fest_id: string; direction: string; status: string; brand_user_id: string }[]>`
    select r.id, r.fest_id, r.direction, r.status, r.brand_user_id from sponsor_requests r join fests f on f.id = r.fest_id
    where r.id = ${id} and ${side === 'brand' ? sql`r.brand_user_id = ${user.id}` : canManage(user)}`;
  if (!r) return { error: 'Request not found.' };
  if (!user.verified) return { error: 'Confirm your email first.' };
  const receiver: Side = r.direction === 'brand_to_org' ? 'org' : 'brand';
  if ((what === 'withdraw') === (side === receiver)) {
    return { error: what === 'withdraw' ? 'Only the side that sent a request can withdraw it.' : 'Only the side that received a request can answer it.' };
  }
  const answered = { error: 'This request was already answered.', festId: r.fest_id };
  if (reply.length > LIMITS.reply) return { error: `Keep the note to ${LIMITS.reply} characters.` };

  if (what !== 'accept') {
    const done = await sql`
      update sponsor_requests set status = ${what === 'decline' ? 'declined' : 'withdrawn'}, decided_by = ${user.id}, decided_at = now(),
        reply = ${what === 'decline' && reply ? reply : null}
      where id = ${r.id} and status = 'sent' returning id`;
    return done.length ? { ok: true, message: what === 'decline' ? 'Declined.' : 'Withdrawn.', festId: r.fest_id } : answered;
  }

  const res = await sql.begin(async (tx) => {
    const [a] = await tx<{ fest_id: string; brand: string; tier: string; amount_paise: number; email: string }[]>`
      update sponsor_requests r set status = 'accepted', decided_by = ${user.id}, decided_at = now()
      from fests f, users u
      where r.id = ${r.id} and r.status = 'sent' and f.id = r.fest_id and u.id = r.brand_user_id and ${festOpen()}
      returning r.fest_id, r.tier, r.amount_paise, u.email::text as email,
        coalesce((select p.brand from brand_profiles p where p.user_id = r.brand_user_id), r.brand) as brand`;
    if (!a) return null;
    // One sponsor per brand email per fest: if the organizer already added this email (any brand name), that row takes
    // the accepted deal — the brand's profile name, tier and amount — so the list, dashboards, report and emails agree.
    const [ex] = await tx<{ id: string }[]>`
      select id from sponsors where fest_id = ${a.fest_id} and email = ${a.email}
      order by (brand = ${a.brand}) desc, created_at limit 1 for update`;
    const [s] = ex
      ? await tx<{ id: string }[]>`
          update sponsors set brand = ${a.brand}, tier = ${a.tier}, amount_paise = ${a.amount_paise} where id = ${ex.id} returning id`
      : await tx<{ id: string }[]>`
          insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code)
          values (${a.fest_id}, ${a.email}, ${a.brand}, ${a.tier}, ${a.amount_paise}, ${boothCode()})
          on conflict (fest_id, email, brand) do update set tier = excluded.tier, amount_paise = excluded.amount_paise
          returning id`;
    await tx`update sponsor_requests set sponsor_id = ${s.id}, brand = ${a.brand} where id = ${r.id}`;
    return s.id;
  });
  if (!res) {
    const [now] = await sql<{ status: string }[]>`select status from sponsor_requests where id = ${r.id}`;
    if (now?.status !== 'sent') return answered;
    return { error: 'This fest is no longer live (it ended, was cancelled or is not approved), so the request can’t be accepted.', festId: r.fest_id };
  }
  return { ok: true, message: 'Accepted — the sponsor is added. Payment is settled directly between you; THE FEST doesn’t take a cut yet.', festId: r.fest_id, sponsorId: res };
}

/** A request as either side sees it. Contact emails are filled in only after accept. */
export type RequestView = {
  id: string; fest_id: string; direction: 'org_to_brand' | 'brand_to_org'; brand: string; tier: string; amount_paise: number;
  deliverables: string | null; message: string | null; status: 'sent' | 'accepted' | 'declined' | 'withdrawn'; reply: string | null;
  sponsor_id: string | null; created_at: string; fest_name: string; college: string; city: string; starts_on: string; ends_on: string;
  expired: boolean; contact: string | null; category: string | null;
};

const VIEW_COLS = (brandSide: boolean) => sql`
  r.id, r.fest_id, r.direction, r.brand, r.tier, r.amount_paise, r.deliverables, r.message, r.status, r.reply, r.sponsor_id,
  r.created_at, f.name as fest_name, f.college, f.city, f.starts_on, f.ends_on,
  (r.status = 'sent' and not ${festOpen()}) as expired,
  case when r.status = 'accepted' then ${brandSide
    ? sql`(select o.email::text from users o where o.id = f.organizer_id)`
    : sql`(select b.email::text from users b where b.id = r.brand_user_id)`} end as contact,
  (select p.category from brand_profiles p where p.user_id = r.brand_user_id) as category`;

export const brandRequests = (userId: string) => sql<RequestView[]>`
  select ${VIEW_COLS(true)} from sponsor_requests r join fests f on f.id = r.fest_id
  where r.brand_user_id = ${userId} order by (r.status = 'sent' and ${festOpen()}) desc, r.created_at desc limit 200`;

export const festRequests = (festId: string) => sql<RequestView[]>`
  select ${VIEW_COLS(false)} from sponsor_requests r join fests f on f.id = r.fest_id
  where r.fest_id = ${festId} order by (r.status = 'sent' and ${festOpen()}) desc, r.created_at desc limit 200`;

/** The media kit: real, aggregate ticket numbers only — no names or emails; colleges under 5 people go to "Other". */
export async function mediaKit(festId: string) {
  const [a, colleges, [prev]] = await Promise.all([
    festAnalytics(festId),
    sql<{ college: string | null; n: number }[]>`
      select nullif(trim(u.college), '') as college, count(*)::int n from tickets t join users u on u.id = t.user_id
      where t.fest_id = ${festId} and t.status <> 'void' group by 1`,
    sql<{ name: string; checked_in: number }[]>`
      select p.name, (select count(*) from tickets t where t.fest_id = p.id and t.status = 'used')::int as checked_in
      from fests f join fests p on p.organizer_id = f.organizer_id and p.id <> f.id
      where f.id = ${festId} and p.ends_on < ${todayIST()} and p.status in ('live', 'ended')
      order by p.ends_on desc limit 1`,
  ]);
  return {
    tickets: a.totals.tickets, capacity: a.totals.capacity, hostShare: a.totals.host_share,
    collegeCount: colleges.filter((c) => c.college).length, colleges: groupColleges(colleges, 7), prev: prev ?? null,
  };
}

/** Emails for a request event. Before accept they never carry the other side's contact details. */
export async function requestEmailTargets(id: string) {
  const [r] = await sql<{ direction: string; brand: string; fest_id: string; fest_name: string; sponsor_id: string | null; status: string;
    brand_email: string; owner_email: string; sender_email: string | null; reply: string | null; tier: string; amount_paise: number }[]>`
    select r.direction, r.brand, r.fest_id, f.name as fest_name, r.sponsor_id, r.status, b.email::text as brand_email,
           o.email::text as owner_email, s.email::text as sender_email, r.reply, r.tier, r.amount_paise
    from sponsor_requests r join fests f on f.id = r.fest_id join users b on b.id = r.brand_user_id join users o on o.id = f.organizer_id
    left join users s on s.id = r.sent_by where r.id = ${id}`;
  if (!r) return null;
  const members = await sql<{ email: string }[]>`select email::text from fest_members where fest_id = ${r.fest_id}`;
  return { ...r, orgEmails: [...new Set([r.owner_email, ...members.map((m) => m.email)])] };
}

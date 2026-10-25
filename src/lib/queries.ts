import 'server-only';
import { sql } from './db';
import type { Announcement, Fest, ScheduleEvent, Sponsor, TicketType, User } from './types';
import { eventsReady, rolesReady } from './fest-access';
import { ROLE_COUNTER, isRoleKey, scannerLabel, type Counter } from './roles';
import { todayIST } from './format';

export type FestListItem = Fest & { min_price: number | null; sold: number; quota: number };

export async function listLiveFests(opts: { q?: string; category?: string } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const cat = opts.category && opts.category !== 'all' ? opts.category : null;
  return sql<FestListItem[]>`
    select f.*,
      (select min(price_paise) from ticket_types t where t.fest_id = f.id and t.active and t.kind = 'entry')::int as min_price,
      (select coalesce(sum(sold), 0) from ticket_types t where t.fest_id = f.id and t.kind = 'entry')::int as sold,
      (select coalesce(sum(quota), 0) from ticket_types t where t.fest_id = f.id and t.kind = 'entry')::int as quota
    from fests f
    where f.status = 'live' and f.ends_on >= (now() at time zone 'Asia/Kolkata')::date
      ${q ? sql`and (f.name ilike ${q} or f.college ilike ${q} or f.city ilike ${q})` : sql``}
      ${cat ? sql`and f.category = ${cat}` : sql``}
    order by f.starts_on asc
    limit 60`;
}

export async function getFestBySlug(slug: string) {
  const [f] = await sql<Fest[]>`select * from fests where slug = ${slug}`;
  return f ?? null;
}

/** All ticket types (organizer), or only `kind` ones — the fest page sells 'entry', the ticket page 'addon'. */
export const getTicketTypes = (festId: string, kind?: TicketType['kind']) =>
  sql<TicketType[]>`select * from ticket_types where fest_id = ${festId} ${kind ? sql`and kind = ${kind}` : sql``} order by sort, price_paise`;

export const getSchedule = (festId: string) =>
  sql<ScheduleEvent[]>`select * from schedule_events where fest_id = ${festId} order by starts_at`;

export const getAnnouncements = (festId: string, limit = 20) =>
  sql<Announcement[]>`select * from announcements where fest_id = ${festId} order by created_at desc limit ${limit}`;

export const getSponsors = (festId: string) =>
  sql<(Sponsor & { visits: number })[]>`
    select s.*, s.email::text as email, (select count(*) from sponsor_visits v where v.sponsor_id = s.id)::int as visits
    from sponsors s where s.fest_id = ${festId} order by s.amount_paise desc`;

export async function festStats(festId: string) {
  const [s] = await sql<{
    tickets: number; checked_in: number; revenue: number; fees: number; orders: number;
    sold_today: number; scans_hour: number; blocked: number; quota: number;
  }[]>`
    select
      (select count(*) from tickets where fest_id = ${festId} and status <> 'void')::int as tickets,
      (select count(*) from tickets where fest_id = ${festId} and status = 'used')::int as checked_in,
      -- revenue = what the organizer earns (collected minus THE FEST fee)
      (select coalesce(sum(amount_paise - refunded_paise - platform_fee_paise - gateway_fee_paise), 0) from orders where fest_id = ${festId} and status in ('paid', 'refunded'))::bigint::int as revenue,
      (select coalesce(sum(platform_fee_paise), 0) from orders where fest_id = ${festId} and status = 'paid')::int as fees,
      (select count(*) from orders where fest_id = ${festId} and status = 'paid' and not exists (select 1 from ticket_types x where x.id = ticket_type_id and x.kind = 'event'))::int as orders,
      (select coalesce(sum(qty), 0) from orders where fest_id = ${festId} and status = 'paid' and paid_at > now() - interval '24 hours' and not exists (select 1 from ticket_types x where x.id = ticket_type_id and x.kind = 'event'))::int as sold_today,
      (select count(*) from scans where fest_id = ${festId} and result = 'admitted' and created_at > now() - interval '1 hour')::int as scans_hour,
      (select count(*) from scans where fest_id = ${festId} and result <> 'admitted')::int as blocked,
      (select coalesce(sum(quota), 0) from ticket_types where fest_id = ${festId} and kind = 'entry')::int as quota`;
  return s;
}

export type ScanFest = Fest & {
  /** Owner or co-organizer: any counter and the organizer's sealed section. */
  manager: boolean;
  /** Counters this person works today (volunteers: from their role(s)). */
  counters: Counter[];
  /** Has a scanning role at this fest, but only on another day (IST): that day. */
  shift_day: string | null;
};

/**
 * Fests this person may scan for, and how. Owner / co-organizer → manager. Gate volunteer and Desk volunteer → gate,
 * Lunch volunteer → lunch, Stay volunteer → stay (several roles → several counters). Roles count only with a confirmed
 * email; a day-limited role only on that IST day (otherwise `shift_day` says when).
 */
export async function scannableFests(user: User): Promise<ScanFest[]> {
  const withRoles = await rolesReady();
  const rows = await sql<(Fest & { r_role: string | null; r_day: string | null; r_scan: boolean | null; is_owner: boolean })[]>`
    select f.*, (f.organizer_id = ${user.id}) as is_owner, r.role as r_role, r.scope_day::text as r_day, r.can_scan as r_scan
    from fests f
    ${withRoles ? sql`left join fest_roles r on r.fest_id = f.id and r.email = ${user.email} and ${user.verified}` : sql`left join (select null::text as role, null::date as scope_day, null::boolean as can_scan) r on false`}
    where f.status in ('live', 'review', 'draft')
      and (f.organizer_id = ${user.id} ${withRoles ? sql`or r.id is not null` : sql``})
    order by f.starts_on, f.id`;
  const today = todayIST();
  const out = new Map<string, ScanFest>();
  for (const row of rows) {
    const { r_role, r_day, r_scan, is_owner, ...f } = row;
    const cur = out.get(f.id) ?? { ...(f as Fest), manager: is_owner, counters: [], shift_day: null };
    const role = isRoleKey(r_role) ? r_role : null;
    const todayOk = !r_day || r_day === today;
    if (role === 'co_organizer' && todayOk) cur.manager = true;
    const c = role ? ROLE_COUNTER[role] : undefined;
    if (c && r_scan) {
      if (todayOk) { if (!cur.counters.includes(c)) cur.counters.push(c); }
      else if (r_day && r_day > today && (!cur.shift_day || cur.shift_day < today || r_day < cur.shift_day)) cur.shift_day = r_day;
      else if (r_day && !cur.shift_day) cur.shift_day = r_day;
    }
    out.set(f.id, cur);
  }
  // v2.8: the Event counter (event heads; managers too) only once the events tables exist
  const order: Counter[] = (await eventsReady()) ? ['gate', 'lunch', 'stay', 'event'] : ['gate', 'lunch', 'stay'];
  return [...out.values()]
    .map((f) => ({ ...f, counters: f.manager ? order : order.filter((c) => f.counters.includes(c)) }))
    .filter((f) => f.manager || f.counters.length || f.shift_day);
}

/** The scanner link label for this person at this fest today ("Gate scanner", "Scanner"…), or null if they can't scan. */
export async function scannerAt(user: User, festId: string): Promise<string | null> {
  const f = (await scannableFests(user)).find((x) => x.id === festId);
  return f && f.counters.length ? scannerLabel(f.counters) : null;
}

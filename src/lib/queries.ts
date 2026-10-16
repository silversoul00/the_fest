import 'server-only';
import { notFound } from 'next/navigation';
import { sql } from './db';
import type { Announcement, Fest, ScheduleEvent, Sponsor, Staff, TicketType, User } from './types';

export type FestListItem = Fest & { min_price: number | null; sold: number; quota: number };

export async function listLiveFests(opts: { q?: string; category?: string } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;
  const cat = opts.category && opts.category !== 'all' ? opts.category : null;
  return sql<FestListItem[]>`
    select f.*,
      (select min(price_paise) from ticket_types t where t.fest_id = f.id and t.active)::int as min_price,
      (select coalesce(sum(sold), 0) from ticket_types t where t.fest_id = f.id)::int as sold,
      (select coalesce(sum(quota), 0) from ticket_types t where t.fest_id = f.id)::int as quota
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

/** Organizer-owned fest or 404. */
/** SQL condition: `user` runs fest `f` — as its owner or as a co-organizer added by email. */
export const canManage = (user: Pick<User, 'id' | 'email' | 'verified'>, alias = 'f') =>
  user.verified
    ? sql`(${sql(alias)}.organizer_id = ${user.id} or exists (select 1 from fest_members m where m.fest_id = ${sql(alias)}.id and m.email = ${user.email}))`
    : sql`(${sql(alias)}.organizer_id = ${user.id})`;

/** A fest the user runs (owner or co-organizer). `is_owner` gates money and team settings. */
export async function getOwnFest(festId: string, user: User) {
  if (!/^[0-9a-f-]{36}$/i.test(festId)) notFound();
  const [f] = await sql<(Fest & { is_owner: boolean })[]>`
    select f.*, (f.organizer_id = ${user.id}) as is_owner from fests f where f.id = ${festId} and ${canManage(user)}`;
  if (!f) notFound();
  return f;
}

export const getMembers = (festId: string) =>
  sql<{ id: string; email: string; created_at: Date; name: string | null }[]>`
    select m.id, m.email::text, m.created_at, u.name from fest_members m left join users u on u.email = m.email
    where m.fest_id = ${festId} order by m.created_at`;

export const getTicketTypes = (festId: string) =>
  sql<TicketType[]>`select * from ticket_types where fest_id = ${festId} order by sort, price_paise`;

export const getSchedule = (festId: string) =>
  sql<ScheduleEvent[]>`select * from schedule_events where fest_id = ${festId} order by starts_at`;

export const getAnnouncements = (festId: string, limit = 20) =>
  sql<Announcement[]>`select * from announcements where fest_id = ${festId} order by created_at desc limit ${limit}`;

export const getStaff = (festId: string) =>
  sql<Staff[]>`select id, fest_id, email::text, name, duty, can_scan, checked_in_at from fest_staff where fest_id = ${festId} order by duty, name`;

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
      (select count(*) from orders where fest_id = ${festId} and status = 'paid')::int as orders,
      (select coalesce(sum(qty), 0) from orders where fest_id = ${festId} and status = 'paid' and paid_at > now() - interval '24 hours')::int as sold_today,
      (select count(*) from scans where fest_id = ${festId} and result = 'admitted' and created_at > now() - interval '1 hour')::int as scans_hour,
      (select count(*) from scans where fest_id = ${festId} and result <> 'admitted')::int as blocked,
      (select coalesce(sum(quota), 0) from ticket_types where fest_id = ${festId})::int as quota`;
  return s;
}

/** Can this user scan for this fest? Organizer of the fest, or staff with can_scan. */
export async function scannableFests(user: User) {
  return sql<(Fest & { duty: string | null })[]>`
    select f.*, null::text as duty from fests f where ${canManage(user)} and f.status in ('live', 'review', 'draft')
    union
    select f.*, s.duty from fests f join fest_staff s on s.fest_id = f.id
    where s.email = ${user.email} and ${user.verified} and s.can_scan and f.status in ('live', 'review', 'draft')
    order by starts_on`;
}

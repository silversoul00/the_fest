import 'server-only';
import { sql } from './db';
import { todayIST } from './format';
import { groupColleges, leadsReady } from './sponsor-leads';

/*
 * Sponsor ROI report — computed when the page opens, from THE FEST's own records only (no estimates).
 * Callers check access first (sponsor owner, or an organizer of the fest). Aggregates only: no names, emails or phones.
 */
export type SponsorReport = {
  brand: string; tier: string; amount_paise: number;
  fest_name: string; college: string; city: string; starts_on: string; ends_on: string;
  sample: boolean; inProgress: boolean;
  attendees: number; footfall: number; visitsAll: number; visits: number; leads: number | null;
  byDay: { day: string; n: number }[];
  entryHours: { h: number; n: number }[];
  visitHours: { h: number; n: number }[];
  colleges: { college: string; n: number }[];
};

export async function loadSponsorReport(sponsorId: string): Promise<SponsorReport | null> {
  const [s] = await sql<{ id: string; fest_id: string; brand: string; tier: string; amount_paise: number; fest_name: string; college: string; city: string; starts_on: string; ends_on: string; status: string; sample: boolean }[]>`
    select s.id, s.fest_id, s.brand, s.tier, s.amount_paise, f.name as fest_name, f.college, f.city, f.starts_on, f.ends_on, f.status,
           (s.email ilike '%@thefest.in' or s.email ilike '%@seed.thefest.in' or o.email ilike '%@thefest.in' or o.email ilike '%@seed.thefest.in') as sample
    from sponsors s join fests f on f.id = s.fest_id join users o on o.id = f.organizer_id
    where s.id = ${sponsorId}`;
  if (!s) return null;
  const withLeads = await leadsReady();

  // Footfall = gate-scanned tickets (add-on orders issue no tickets, so every ticket row is an entry ticket).
  // Verified visit = the visitor holds a gate-scanned ticket for this fest.
  const [[m], byDay, entryHours, visitHours, colleges, leads] = await Promise.all([
    sql<{ attendees: number; footfall: number; visits_all: number; visits: number }[]>`
      select (select count(*) from tickets where fest_id = ${s.fest_id} and status <> 'void')::int attendees,
             (select count(*) from tickets where fest_id = ${s.fest_id} and status = 'used')::int footfall,
             (select count(*) from sponsor_visits where sponsor_id = ${s.id})::int visits_all,
             (select count(*) from sponsor_visits v where v.sponsor_id = ${s.id} and exists
                (select 1 from tickets t where t.fest_id = ${s.fest_id} and t.user_id = v.user_id and t.status = 'used'))::int visits`,
    sql<{ day: string; n: number }[]>`
      select to_char(checked_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*)::int n
      from tickets where fest_id = ${s.fest_id} and status = 'used' and checked_in_at is not null group by 1 order by 1`,
    sql<{ h: number; n: number }[]>`
      select extract(hour from checked_in_at at time zone 'Asia/Kolkata')::int h, count(*)::int n
      from tickets where fest_id = ${s.fest_id} and status = 'used' and checked_in_at is not null group by 1 order by 1`,
    sql<{ h: number; n: number }[]>`
      select extract(hour from v.created_at at time zone 'Asia/Kolkata')::int h, count(*)::int n
      from sponsor_visits v where v.sponsor_id = ${s.id} and exists
        (select 1 from tickets t where t.fest_id = ${s.fest_id} and t.user_id = v.user_id and t.status = 'used')
      group by 1 order by 1`,
    // one row per checked-in person (not per ticket)
    sql<{ college: string | null; n: number }[]>`
      select nullif(trim(u.college), '') as college, count(*)::int n
      from (select distinct user_id from tickets where fest_id = ${s.fest_id} and status = 'used') t
      join users u on u.id = t.user_id group by 1`,
    withLeads
      ? sql<{ n: number }[]>`select count(*)::int n from sponsor_leads where sponsor_id = ${s.id} and withdrawn_at is null`
      : Promise.resolve(null),
  ]);

  const today = todayIST();
  return {
    brand: s.brand, tier: s.tier, amount_paise: s.amount_paise,
    fest_name: s.fest_name, college: s.college, city: s.city, starts_on: s.starts_on, ends_on: s.ends_on,
    sample: s.sample, inProgress: s.status === 'live' && s.starts_on <= today && today <= s.ends_on,
    attendees: m.attendees, footfall: m.footfall, visitsAll: m.visits_all, visits: m.visits, leads: leads ? leads[0].n : null,
    byDay: [...byDay], entryHours: [...entryHours], visitHours: [...visitHours],
    colleges: groupColleges([...colleges], 8),
  };
}

/** paise ÷ count, rounded once; null when the count is 0 (shown as "—"). */
export const perHead = (paise: number, n: number | null) => (n ? Math.round(paise / n) : null);
/** a ÷ b as a whole percent; null when b is 0. */
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

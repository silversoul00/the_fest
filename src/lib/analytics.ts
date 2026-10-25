import 'server-only';
import { sql } from './db';

/** Everything the organizer Analytics tab shows, for one fest. All times in IST. */
export async function festAnalytics(festId: string) {
  const [totals, sales, types, entries, colleges, methods, buyHours, problems, gates] = await Promise.all([
    sql<{
      tickets: number; used: number; orders: number; gross: number; net: number; refunded: number; refund_orders: number;
      quota: number; capacity: number | null; host_college: string; host_share: number | null; started: boolean;
    }[]>`
      select
        (select count(*) from tickets where fest_id = f.id and status <> 'void')::int as tickets,
        (select count(*) from tickets where fest_id = f.id and status = 'used')::int as used,
        (select count(*) from orders where fest_id = f.id and status in ('paid', 'refunded') and not exists (select 1 from ticket_types x where x.id = ticket_type_id and x.kind = 'event'))::int as orders,  -- ticket orders (event entries are money, not tickets)
        (select coalesce(sum(amount_paise - refunded_paise), 0) from orders where fest_id = f.id and status in ('paid', 'refunded'))::bigint::int as gross,
        (select coalesce(sum(amount_paise - refunded_paise - platform_fee_paise - gateway_fee_paise), 0) from orders where fest_id = f.id and status in ('paid', 'refunded'))::bigint::int as net,
        (select coalesce(sum(refunded_paise), 0) from orders where fest_id = f.id and status in ('paid', 'refunded'))::bigint::int as refunded,
        (select count(*) from orders where fest_id = f.id and refunded_paise > 0 and status in ('paid', 'refunded'))::int as refund_orders,
        (select coalesce(sum(quota), 0) from ticket_types where fest_id = f.id and kind <> 'event')::int as quota,
        f.capacity, f.college as host_college,
        (select avg((lower(coalesce(u.college, '')) = lower(f.college))::int)::float from tickets t join users u on u.id = t.user_id
          where t.fest_id = f.id and t.status <> 'void') as host_share,
        (f.starts_on <= (now() at time zone 'Asia/Kolkata')::date) as started
      from fests f where f.id = ${festId}`,

    // Tickets sold per day, from the first sale to today (or the fest's last day), max 120 days
    sql<{ d: string; qty: number }[]>`
      with bounds as (
        select min((paid_at at time zone 'Asia/Kolkata')::date) as first_day,
               least((now() at time zone 'Asia/Kolkata')::date, (select ends_on from fests where id = ${festId})) as last_day
        from orders where fest_id = ${festId} and status in ('paid', 'refunded') and qty > 0 and paid_at is not null and not exists (select 1 from ticket_types x where x.id = ticket_type_id and x.kind = 'event')
      )
      select to_char(g.d, 'YYYY-MM-DD') as d, coalesce(sum(o.qty), 0)::int as qty
      from bounds b
      cross join generate_series(greatest(b.first_day, b.last_day - 119), greatest(b.last_day, b.first_day), '1 day') g(d)
      left join orders o on o.fest_id = ${festId} and o.status in ('paid', 'refunded') and (o.paid_at at time zone 'Asia/Kolkata')::date = g.d and not exists (select 1 from ticket_types x where x.id = o.ticket_type_id and x.kind = 'event')
      where b.first_day is not null
      group by g.d order by g.d`,

    sql<{ name: string; price: number; sold: number; quota: number; used: number; revenue: number; active: boolean }[]>`
      select tt.name, tt.price_paise as price, tt.quota, tt.active,
        (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status <> 'void')::int as sold,
        (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status = 'used')::int as used,
        (select coalesce(sum(o.amount_paise - o.refunded_paise), 0) from orders o where o.ticket_type_id = tt.id and o.status in ('paid', 'refunded'))::bigint::int as revenue
      from ticket_types tt where tt.fest_id = ${festId} and tt.kind <> 'event' order by tt.sort, tt.price_paise`,

    // Gate entries per hour, across the hours that had any entries (max 96 hours)
    sql<{ h: string; n: number }[]>`
      with s as (
        select date_trunc('hour', created_at at time zone 'Asia/Kolkata') as h from scans
        where fest_id = ${festId} and result = 'admitted'
      ), b as (select min(h) lo, max(h) hi from s)
      select to_char(g.h, 'YYYY-MM-DD"T"HH24') as h, count(s.h)::int as n
      from b cross join generate_series(greatest(b.lo, b.hi - interval '95 hours'), b.hi, '1 hour') g(h)
      left join s on s.h = g.h
      where b.lo is not null
      group by g.h order by g.h`,

    sql<{ college: string; n: number }[]>`
      select coalesce(nullif(trim(u.college), ''), 'Not given') as college, count(*)::int as n
      from tickets t join users u on u.id = t.user_id
      where t.fest_id = ${festId} and t.status <> 'void'
      group by 1 order by 2 desc`,

    sql<{ method: string; tickets: number; orders: number; amount: number }[]>`
      select coalesce(method, 'gateway') as method, coalesce(sum(qty) filter (where not exists (select 1 from ticket_types x where x.id = ticket_type_id and x.kind = 'event')), 0)::int as tickets, count(*)::int as orders,
             coalesce(sum(amount_paise - refunded_paise), 0)::bigint::int as amount
      from orders where fest_id = ${festId} and status in ('paid', 'refunded')
      group by 1 order by 2 desc`,

    sql<{ h: number; qty: number }[]>`
      select extract(hour from paid_at at time zone 'Asia/Kolkata')::int as h, sum(qty)::int as qty
      from orders where fest_id = ${festId} and status in ('paid', 'refunded') and paid_at is not null and not exists (select 1 from ticket_types x where x.id = ticket_type_id and x.kind = 'event')
      group by 1 order by 1`,

    sql<{ result: string; n: number }[]>`
      select result::text, count(*)::int as n from scans where fest_id = ${festId} and result <> 'admitted' group by 1 order by 2 desc`,

    sql<{ gate: string; n: number }[]>`
      select coalesce(nullif(gate, ''), 'No gate set') as gate, count(*)::int as n from scans
      where fest_id = ${festId} and result = 'admitted' group by 1 order by 2 desc`,
  ]);

  // Cumulative sales
  let run = 0;
  const salesDays = sales.map((s) => ({ d: s.d, qty: s.qty, total: (run += s.qty) }));

  // Colleges: top 7 + everyone else
  const top = colleges.slice(0, 7);
  const rest = colleges.slice(7).reduce((s, c) => s + c.n, 0);
  const collegeRows = rest > 0 ? [...top, { college: `Other (${colleges.length - 7} colleges)`, n: rest }] : top;

  const buyByHour = Array.from({ length: 24 }, (_, h) => ({ h, qty: buyHours.find((b) => b.h === h)?.qty ?? 0 }));
  const peakEntry = entries.reduce<{ h: string; n: number } | null>((p, e) => (!p || e.n > p.n ? e : p), null);

  return {
    totals: totals[0], salesDays, types, entries, peakEntry, collegeRows, collegeCount: colleges.length,
    methods, buyByHour, problems, gates,
  };
}

export type FestAnalytics = Awaited<ReturnType<typeof festAnalytics>>;

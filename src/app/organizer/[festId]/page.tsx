import Link from 'next/link';
import { pageAccess, rolesReady } from '@/lib/fest-access';
import { sql } from '@/lib/db';
import { festStats, scannerAt } from '@/lib/queries';
import { ago, num, rupees, time } from '@/lib/format';
import { Stat } from '@/components/ui';
import { AutoRefresh } from '@/components/AutoRefresh';
import { setFestStatus } from '../actions';
import { isRenameNote } from '@/lib/fest-form';

export default async function Overview({ params, searchParams }: { params: Promise<{ festId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { festId } = await params;
  const { created } = await searchParams;
  const { user, fest, access } = await pageAccess(festId, 'overview');
  const scanner = await scannerAt(user, fest.id);
  const money = access.perms.has('money');
  const canPublish = access.perms.has('fest');

  const [stats, daily, hourly, gates, recent, staff, types] = await Promise.all([
    festStats(fest.id),
    sql<{ d: string; qty: number }[]>`
      select to_char(g.d, 'YYYY-MM-DD') as d, coalesce(sum(o.qty), 0)::int as qty
      from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, '1 day') g(d)
      left join orders o on o.fest_id = ${fest.id} and o.status = 'paid' and (o.paid_at at time zone 'Asia/Kolkata')::date = g.d and not exists (select 1 from ticket_types x where x.id = o.ticket_type_id and x.kind = 'event')
      group by g.d order by g.d`,
    sql<{ h: number; n: number }[]>`
      select extract(hour from created_at at time zone 'Asia/Kolkata')::int as h, count(*)::int as n
      from scans where fest_id = ${fest.id} and result = 'admitted'
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
      group by 1 order by 1`,
    sql<{ gate: string; n: number }[]>`
      select coalesce(gate, '—') as gate, count(*)::int as n from scans
      where fest_id = ${fest.id} and result = 'admitted' and created_at > now() - interval '24 hours'
      group by 1 order by 2 desc`,
    sql<{ id: number; result: string; gate: string | null; created_at: Date; holder: string | null; detail: string | null }[]>`
      select s.id, s.result, s.gate, s.created_at, t.holder_name as holder, s.detail
      from scans s left join tickets t on t.id = s.ticket_id
      where s.fest_id = ${fest.id} order by s.created_at desc limit 8`,
    (await rolesReady()) ? sql<{ total: number; inn: number }[]>`
      select count(distinct email)::int as total, count(distinct email) filter (where checked_in_at is not null)::int as inn
      from fest_roles where fest_id = ${fest.id} and role in ('vol_gate', 'vol_lunch', 'vol_stay', 'desk')` : [{ total: 0, inn: 0 }],
    sql<{ n: number }[]>`select count(*)::int n from ticket_types where fest_id = ${fest.id} and active and kind <> 'event'`,
  ]);

  const pct = stats.tickets ? Math.round((stats.checked_in / stats.tickets) * 100) : 0;
  const maxDaily = Math.max(1, ...daily.map((d) => d.qty));
  const hours = Array.from({ length: 14 }, (_, i) => i + 8); // 8 AM – 9 PM
  const byHour = new Map(hourly.map((h) => [h.h, h.n]));
  const maxHour = Math.max(1, ...hours.map((h) => byHour.get(h) ?? 0));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const isLiveDay = fest.status === 'live' && fest.starts_on <= today && today <= fest.ends_on;

  return (
    <div className="stack g16">
      {isLiveDay && <AutoRefresh seconds={15} />}

      {created && <div className="alert ok">🎉 Fest created! Add more ticket types, your schedule and volunteers — then publish.</div>}

      {fest.status === 'draft' && canPublish && (
        <div className="card row between wrap-row g12" style={{ borderColor: 'rgba(255,224,52,.3)' }}>
          <div>
            <div className="h3">Your fest is a draft</div>
            <div className="small soft">
              {isRenameNote(fest.review_note)
                ? <><span className="c-orange">{fest.review_note}</span> Submit it and THE FEST does a quick check of the new name before tickets go on sale again.</>
                : fest.review_note
                ? <>THE FEST sent it back: <span className="c-orange">{fest.review_note}</span> Fix this, then submit again.</>
                : fest.approved_at ? 'Only you can see it. Publish to start selling tickets again.' : 'Only you can see it. Submit it for a quick check by THE FEST — tickets go on sale once approved (usually within a day).'}
            </div>
          </div>
          <form action={setFestStatus}>
            <input type="hidden" name="festId" value={fest.id} />
            <input type="hidden" name="status" value="live" />
            <button className="btn green" disabled={!types[0].n}>{fest.approved_at ? 'Publish fest →' : 'Submit for approval →'}</button>
          </form>
        </div>
      )}
      {fest.status === 'review' && (
        <div className="alert info">Your fest is waiting for THE FEST&apos;s approval.{fest.review_note ? <> {fest.review_note}</> : null} You can keep editing everything meanwhile — you&apos;ll see it go live here once approved.</div>
      )}
      {fest.status === 'cancelled' && (
        <div className="alert error">This fest was cancelled{fest.cancelled_reason ? `: ${fest.cancelled_reason}` : ''}. Ticket sales are closed.</div>
      )}

      <div className="row between wrap-row g8">
        <h1 className="h2">{isLiveDay ? <>Live <span className="c-green">now</span></> : 'Overview'}</h1>
        <Link href={`/fests/${fest.slug}`} className="btn sm outline">Public page ↗</Link>
      </div>

      <div className="grid-2 grid-4">
        <Stat label="Tickets sold" value={num(stats.tickets)} sub={`${num(stats.sold_today)} in last 24h`} />
        {money ? <Stat label="Your revenue" value={rupees(stats.revenue, { compact: true })} sub={`${num(stats.orders)} orders`} color="var(--green)" />
          : <Stat label="Orders" value={num(stats.orders)} color="var(--green)" />}
        <Stat label="Checked in" value={num(stats.checked_in)} sub={`${pct}% of ticket holders`} color="var(--blue)" />
        <Stat label="Entries / hour" value={num(stats.scans_hour)} sub={`${num(stats.blocked)} blocked at gates`} color="var(--orange)" />
      </div>

      <div className="card">
        <div className="card-head"><span className="label">Check-in progress</span><span className="mono small">{num(stats.checked_in)} / {num(stats.tickets)}</span></div>
        <div className="bar" style={{ height: 10 }}><i style={{ width: `${pct}%`, background: 'var(--blue)' }} /></div>
        <div className="row between xs muted mt8"><span>Volunteers on duty: {staff[0].inn} / {staff[0].total}</span><span>Capacity sold: {stats.quota ? Math.round((stats.tickets / stats.quota) * 100) : 0}%</span></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <div className="card">
          <div className="card-head"><span className="label">Tickets sold · last 14 days</span></div>
          <div className="bars">
            {daily.map((d, i) => (
              <div key={d.d} className="col" title={`${d.d}: ${d.qty}`}>
                <i style={{ height: `${(d.qty / maxDaily) * 100}%` }} />
                <span>{i % 3 === 0 || i === daily.length - 1 ? d.d.slice(8) : ''}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ ['--accent' as string]: 'var(--green)' }}>
          <div className="card-head"><span className="label">Entries today by hour</span><span className="mono xs muted">{gates.map((g) => `${g.gate}: ${g.n}`).join(' · ') || '—'}</span></div>
          <div className="bars">
            {hours.map((h) => (
              <div key={h} className="col" title={`${h}:00 — ${byHour.get(h) ?? 0}`}>
                <i style={{ height: `${((byHour.get(h) ?? 0) / maxHour) * 100}%` }} />
                <span>{h % 3 === 0 ? (h > 12 ? `${h - 12}p` : `${h}${h === 12 ? 'p' : 'a'}`) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="label">Latest gate scans</span>
          {scanner && <Link href="/scan/login" className="xs c-green" data-scanner-link>Open {scanner.toLowerCase()} →</Link>}
        </div>
        {recent.length === 0 ? <p className="small muted">No scans yet. Add volunteers, then open the scanner on fest day.</p> : (
          <div className="stack">
            {recent.map((r) => (
              <div key={r.id} className="row g12" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                <span className={`badge ${r.result === 'admitted' ? 'green' : r.result === 'duplicate' ? 'orange' : 'red'}`}>{r.result === 'admitted' ? '✓ In' : r.result === 'duplicate' ? 'Dupe' : 'Blocked'}</span>
                <span className="grow truncate small">{r.holder ?? r.detail ?? 'Unknown ticket'}</span>
                <span className="xs muted hide-sm">{r.gate}</span>
                <span className="xs muted mono" title={time(r.created_at)}>{ago(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

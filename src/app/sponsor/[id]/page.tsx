import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { dateRange, num, rupees, todayIST } from '@/lib/format';
import { Stat } from '@/components/ui';
import { AutoRefresh } from '@/components/AutoRefresh';

export default async function SponsorDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('sponsor');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [s] = await sql<{ id: string; brand: string; tier: string; amount_paise: number; booth_code: string; fest_id: string; fest_name: string; college: string; city: string; starts_on: string; ends_on: string; status: string }[]>`
    select s.id, s.brand, s.tier, s.amount_paise, s.booth_code, f.id as fest_id, f.name as fest_name, f.college, f.city, f.starts_on, f.ends_on, f.status
    from sponsors s join fests f on f.id = s.fest_id
    where s.id = ${id} and s.email = ${user.email} and ${user.verified} and f.status <> 'draft'`;
  if (!s) notFound();

  const [[m], colleges, hourly] = await Promise.all([
    sql<{ attendees: number; footfall: number; visits: number; visits_today: number }[]>`
      select (select count(*) from tickets where fest_id = ${s.fest_id} and status <> 'void')::int attendees,
             (select count(*) from tickets where fest_id = ${s.fest_id} and status = 'used')::int footfall,
             (select count(*) from sponsor_visits where sponsor_id = ${s.id})::int visits,
             (select count(*) from sponsor_visits where sponsor_id = ${s.id}
                and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)::int visits_today`,
    // Audience: colleges of checked-in attendees (aggregate only — no personal data shared with sponsors)
    sql<{ college: string; n: number }[]>`
      select coalesce(u.college, 'Other') as college, count(*)::int n
      from tickets t join users u on u.id = t.user_id
      where t.fest_id = ${s.fest_id} and t.status = 'used'
      group by 1 order by 2 desc limit 6`,
    sql<{ h: number; n: number }[]>`
      select extract(hour from created_at at time zone 'Asia/Kolkata')::int h, count(*)::int n
      from sponsor_visits where sponsor_id = ${s.id} group by 1 order by 1`,
  ]);

  const live = s.status === 'live' && s.starts_on <= todayIST() && todayIST() <= s.ends_on;
  const conv = m.footfall ? Math.round((m.visits / m.footfall) * 100) : 0;
  const maxC = Math.max(1, ...colleges.map((c) => c.n));
  const hours = Array.from({ length: 14 }, (_, i) => i + 8);
  const byH = new Map(hourly.map((x) => [x.h, x.n]));
  const maxH = Math.max(1, ...hours.map((h) => byH.get(h) ?? 0));

  return (
    <main className="wrap page stack g16" style={{ ['--accent' as string]: 'var(--blue)' }}>
      {live && <AutoRefresh seconds={20} />}
      <Link href="/sponsor" className="label">← All sponsorships</Link>
      <div className="row between wrap-row g12">
        <div>
          <div className="row g8"><span className="badge blue">{s.brand}</span><span className="badge gray">{s.tier}</span>{live && <span className="badge green"><span className="dot live" />Live</span>}</div>
          <h1 className="h2 mt12">{s.fest_name}</h1>
          <div className="small muted">{s.college}, {s.city} · {dateRange(s.starts_on, s.ends_on)}</div>
        </div>
        <a className="btn blue sm" href={`/booth/${s.booth_code}/print`} target="_blank" rel="noopener">🖨 Booth QR poster</a>
      </div>

      <div className="grid-2 grid-4">
        <Stat label="Ticket holders" value={num(m.attendees)} sub="your potential reach" color="var(--yellow)" />
        <Stat label="Verified footfall" value={num(m.footfall)} sub="scanned in at the gates" color="var(--green)" />
        <Stat label="Booth visits" value={num(m.visits)} sub={`${num(m.visits_today)} today · ${conv}% of footfall`} color="var(--blue)" />
        <Stat label="Cost per visit" value={m.visits ? rupees(Math.round(s.amount_paise / m.visits)) : '—'} sub={`deal ${rupees(s.amount_paise, { compact: true })}`} color="var(--orange)" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <div className="card">
          <div className="card-head"><span className="label">Booth visits by hour</span></div>
          <div className="bars">
            {hours.map((h) => (
              <div key={h} className="col" title={`${h}:00 — ${byH.get(h) ?? 0}`}>
                <i style={{ height: `${((byH.get(h) ?? 0) / maxH) * 100}%` }} />
                <span>{h % 3 === 0 ? (h > 12 ? `${h - 12}p` : `${h}${h === 12 ? 'p' : 'a'}`) : ''}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><span className="label">Audience by college</span></div>
          {colleges.length === 0 ? <p className="small muted">Appears once attendees check in.</p> : (
            <div className="stack g12">
              {colleges.map((c) => (
                <div key={c.college}>
                  <div className="row between small"><span className="truncate">{c.college}</span><span className="mono">{num(c.n)}</span></div>
                  <div className="bar mt8"><i style={{ width: `${(c.n / maxC) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="xs muted">Numbers are counted from gate scans and booth QR check-ins — not estimates. Attendee data is shared only as totals.</p>
    </main>
  );
}

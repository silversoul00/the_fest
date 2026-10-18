import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { dateRange, num, rupees, todayIST } from '@/lib/format';
import { Stat } from '@/components/ui';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ActionForm, Submit } from '@/components/forms';
import { LEADS_MISSING, OFFER_MAX, groupColleges, leadsReady } from '@/lib/sponsor-leads';
import { saveLeadOffer } from '../actions';

export default async function SponsorDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('sponsor');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [s] = await sql<{ id: string; brand: string; tier: string; amount_paise: number; booth_code: string; fest_id: string; fest_name: string; college: string; city: string; starts_on: string; ends_on: string; status: string }[]>`
    select s.id, s.brand, s.tier, s.amount_paise, s.booth_code, f.id as fest_id, f.name as fest_name, f.college, f.city, f.starts_on, f.ends_on, f.status
    from sponsors s join fests f on f.id = s.fest_id
    where s.id = ${id} and s.email = ${user.email} and ${user.verified} and f.status <> 'draft'`;
  if (!s) notFound();
  const withLeads = await leadsReady();

  const [[m], collegeRows, hourly, leads, withdrawn, [offer]] = await Promise.all([
    sql<{ attendees: number; footfall: number; visits: number; visits_all: number; visits_today: number; leads: number }[]>`
      select (select count(*) from tickets where fest_id = ${s.fest_id} and status <> 'void')::int attendees,
             (select count(*) from tickets where fest_id = ${s.fest_id} and status = 'used')::int footfall,
             (select count(*) from sponsor_visits where sponsor_id = ${s.id})::int visits_all,
             -- verified = the visitor holds a gate-scanned ticket for this fest
             (select count(*) from sponsor_visits v where v.sponsor_id = ${s.id} and exists
                (select 1 from tickets t where t.fest_id = ${s.fest_id} and t.user_id = v.user_id and t.status = 'used'))::int visits,
             ${withLeads ? sql`(select count(*) from sponsor_leads where sponsor_id = ${s.id} and withdrawn_at is null)::int` : sql`0`} leads,
             (select count(*) from sponsor_visits where sponsor_id = ${s.id}
                and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)::int visits_today`,
    // Audience: colleges of checked-in attendees (aggregate only — no personal data shared with sponsors)
    // (groups under 5 are merged into "Other")
    sql<{ college: string | null; n: number }[]>`
      select nullif(trim(u.college), '') as college, count(*)::int n
      from (select distinct user_id from tickets where fest_id = ${s.fest_id} and status = 'used') t
      join users u on u.id = t.user_id group by 1`,
    sql<{ h: number; n: number }[]>`
      select extract(hour from created_at at time zone 'Asia/Kolkata')::int h, count(*)::int n
      from sponsor_visits where sponsor_id = ${s.id} group by 1 order by 1`,
    // Leads: name / college / course only on screen; email and phone only in the CSV
    withLeads ? sql<{ id: string; name: string | null; college: string | null; course_year: string | null; shared_at: Date }[]>`
      select id::text, name, college, course_year, shared_at from sponsor_leads
      where sponsor_id = ${s.id} and withdrawn_at is null order by shared_at desc limit 50` : Promise.resolve([]),
    withLeads ? sql<{ email: string; withdrawn_at: Date }[]>`
      select email::text, withdrawn_at from sponsor_leads
      where sponsor_id = ${s.id} and withdrawn_at is not null order by withdrawn_at desc limit 500` : Promise.resolve([]),
    withLeads ? sql<{ lead_offer: string | null }[]>`select lead_offer from sponsors where id = ${s.id}` : Promise.resolve([{ lead_offer: null }]),
  ]);
  const colleges = groupColleges([...collegeRows], 6);
  const ist = (d: Date, time = true) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });

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
        <div className="row g8 wrap-row">
          <a className="btn blue" href={`/booth/${s.booth_code}/print`} target="_blank" rel="noopener">🖨 Booth QR poster</a>
          <Link className="btn outline" href={`/sponsor/${s.id}/report`}>📄 View / print report</Link>
        </div>
      </div>

      <div className="grid-2 grid-3">
        <Stat label="Ticket holders" value={num(m.attendees)} sub="your potential reach" color="var(--yellow)" />
        <Stat label="Verified footfall" value={num(m.footfall)} sub="scanned in at the gates" color="var(--green)" />
        <Stat label="Booth visits (verified)" value={num(m.visits)} sub={`${num(m.visits_all)} incl. unverified · ${num(m.visits_today)} today · ${conv}% of footfall`} color="var(--blue)" />
        <Stat label="Cost per visit" value={m.visits ? rupees(Math.round(s.amount_paise / m.visits)) : '—'} sub={`deal ${rupees(s.amount_paise, { compact: true })}`} color="var(--orange)" />
        <Stat label="Leads" value={withLeads ? num(m.leads) : '—'} sub="students who chose to share" color="var(--green)" />
        <Stat label="Cost per lead" value={m.leads ? rupees(Math.round(s.amount_paise / m.leads)) : '—'} color="var(--orange)" />
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

      {!withLeads ? <p className="small muted card">{LEADS_MISSING}</p> : (
        <>
          <section className="card stack g12" aria-label="Leads">
            <div className="card-head row between wrap-row g8"><span className="label">Leads — newest {Math.min(50, leads.length)} of {num(m.leads)}</span></div>
            {leads.length === 0 ? <p className="small muted">No leads yet. Students can choose to share their contact after checking in at your booth.</p> : (
              <div className="list">
                {leads.map((l) => (
                  <div key={l.id} className="li">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate">{l.name}</div>
                      <div className="xs muted truncate">{[l.college, l.course_year].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    <span className="xs muted mono">{ist(l.shared_at)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="xs muted">Email and phone are in the download. By downloading you agree to use these contacts only for the purpose shown to students and to delete anyone listed as withdrawn.</p>
            <a className="btn blue block" href={`/sponsor/${s.id}/leads.csv`}>⬇ Download leads (CSV)</a>
          </section>

          <section className="card stack g12" aria-label="Withdrawn">
            <span className="label">Withdrawn: remove from your lists</span>
            {withdrawn.length === 0 ? <p className="small muted">Nobody has stopped sharing.</p> : (
              <div className="list">
                {withdrawn.map((w) => (
                  <div key={w.email} className="li"><span className="grow truncate small">{w.email}</span><span className="xs muted mono">{ist(w.withdrawn_at, false)}</span></div>
                ))}
              </div>
            )}
            <p className="xs muted">These students stopped sharing. Delete them from anything you downloaded. They are also in the CSV with status &ldquo;withdrawn&rdquo;.</p>
          </section>

          <section className="card stack g12" aria-label="What students get for sharing">
            <span className="label">What students get for sharing (optional)</span>
            <ActionForm action={saveLeadOffer} className="stack g12">
              <input type="hidden" name="id" value={s.id} />
              <input className="input" name="lead_offer" maxLength={OFFER_MAX} defaultValue={offer?.lead_offer ?? ''} placeholder="e.g. Free energy drink + 20% off coupon" aria-label="What students get for sharing" />
              <Submit className="btn outline block">Save</Submit>
            </ActionForm>
          </section>
        </>
      )}

      <p className="xs muted">Numbers are counted from gate scans and booth QR check-ins — not estimates. Audience is shared only as totals; contacts only from students who chose to share.</p>
    </main>
  );
}

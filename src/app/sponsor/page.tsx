import { VerifyNotice } from '@/components/VerifyNotice';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { dateRange, num, rupees } from '@/lib/format';
import { Empty, FestStatus } from '@/components/ui';
import { SponsorShell } from '@/components/SponsorShell';

export const metadata = { title: 'Sponsor dashboard' };

type Row = {
  id: string; brand: string; tier: string; amount_paise: number; fest_name: string; slug: string; emoji: string; accent: string;
  college: string; starts_on: string; ends_on: string; status: 'draft' | 'live' | 'ended'; attendees: number; footfall: number; visits: number;
};

export default async function SponsorHome() {
  const user = await requireUser('sponsor');
  const rows = await sql<Row[]>`
    select s.id, s.brand, s.tier, s.amount_paise, f.name as fest_name, f.slug, f.emoji, f.accent, f.college, f.starts_on, f.ends_on, f.status,
      (select count(*) from tickets t where t.fest_id = f.id and t.status <> 'void')::int as attendees,
      (select count(*) from tickets t where t.fest_id = f.id and t.status = 'used')::int as footfall,
      (select count(*) from sponsor_visits v where v.sponsor_id = s.id)::int as visits
    from sponsors s join fests f on f.id = s.fest_id
    where s.email = ${user.email} and ${user.verified} and f.status <> 'draft'
    order by f.starts_on desc`;

  const totals = rows.reduce((a, r) => ({ spend: a.spend + r.amount_paise, foot: a.foot + r.footfall, visits: a.visits + r.visits }), { spend: 0, foot: 0, visits: 0 });

  return (
    <SponsorShell user={user} cur="home">
        <div>
          <span className="kicker" style={{ color: 'var(--blue)' }}>Sponsor dashboard</span>
          <h1 className="h2 mt8">Your <span className="c-blue">sponsorships</span></h1>
        </div>

        {!user.verified && <VerifyNotice email={user.email} />}
        {rows.length === 0 ? (
          <Empty icon="🏷️" title="No sponsorships linked yet">
            When a fest organizer adds <strong>{user.email}</strong> as a sponsor, it appears here automatically.
          </Empty>
        ) : (
          <>
            <div className="grid-2 grid-3">
              <div className="stat" style={{ ['--stat' as string]: 'var(--blue)' }}><div className="label">Total spend</div><div className="v">{rupees(totals.spend, { compact: true })}</div><div className="s">{rows.length} fest{rows.length > 1 ? 's' : ''}</div></div>
              <div className="stat" style={{ ['--stat' as string]: 'var(--green)' }}><div className="label">Verified footfall</div><div className="v">{num(totals.foot)}</div><div className="s">gate-scanned attendees</div></div>
              <div className="stat" style={{ ['--stat' as string]: 'var(--yellow)' }}><div className="label">Booth visits</div><div className="v">{num(totals.visits)}</div><div className="s">{totals.visits ? `${rupees(Math.round(totals.spend / totals.visits))} per visit` : 'no visits yet'}</div></div>
            </div>
            <div className="grid-auto">
              {rows.map((r) => (
                <Link key={r.id} href={`/sponsor/${r.id}`} className="card link stack g8" style={{ '--accent': r.accent } as CSSProperties}>
                  <div className="row between"><span style={{ fontSize: 28 }}>{r.emoji}</span><FestStatus fest={r} /></div>
                  <div className="display" style={{ fontSize: 28 }}>{r.fest_name}</div>
                  <div className="xs muted">{r.college} · {dateRange(r.starts_on, r.ends_on)}</div>
                  <div className="row g8 wrap-row"><span className="badge blue">{r.brand}</span><span className="badge gray">{r.tier}</span></div>
                  <div className="row g16 mt8">
                    <span><span className="label">Footfall</span><br /><span className="mono">{num(r.footfall)}</span></span>
                    <span><span className="label">Booth</span><br /><span className="mono">{num(r.visits)}</span></span>
                    <span><span className="label">Deal</span><br /><span className="mono">{rupees(r.amount_paise, { compact: true })}</span></span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
    </SponsorShell>
  );
}

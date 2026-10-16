import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { dateRange, num, rupees } from '@/lib/format';
import { FestStatus } from '@/components/ui';
import type { Fest } from '@/lib/types';
import { logout } from '../(auth)/actions';
import { canManage } from '@/lib/queries';

export const metadata = { title: 'Your fests' };

export default async function OrganizerHome() {
  const user = await requireUser('organizer');
  const fests = await sql<(Fest & { tickets: number; revenue: number })[]>`
    select f.*,
      (select count(*) from tickets t where t.fest_id = f.id and t.status <> 'void')::int as tickets,
      (select coalesce(sum(amount_paise - platform_fee_paise), 0) from orders o where o.fest_id = f.id and o.status = 'paid')::int as revenue
    from fests f where ${canManage(user)}
    order by (f.status = 'ended'), f.starts_on`;
  if (fests.length === 0) redirect('/organizer/new');
  // One fest → straight to its dashboard
  if (fests.length === 1) redirect(`/organizer/${fests[0].id}`);

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <span className="logo">THE FEST</span>
          <form action={logout}><button className="btn sm outline" type="submit">Log out</button></form>
        </div>
      </header>
      <main className="wrap page stack g16">
        <div className="row between wrap-row g12">
          <h1 className="h2">Your fests</h1>
          <Link href="/organizer/new" className="btn orange sm">+ New fest</Link>
        </div>
        <div className="grid-auto">
          {fests.map((f) => (
            <Link key={f.id} href={`/organizer/${f.id}`} className="card link stack g8" style={{ '--accent': f.accent } as CSSProperties}>
              <div className="row between"><span style={{ fontSize: 28 }}>{f.emoji}</span><FestStatus fest={f} /></div>
              <div className="display" style={{ fontSize: 28 }}>{f.name}</div>
              <div className="xs muted">{dateRange(f.starts_on, f.ends_on)} · {f.city}</div>
              <div className="row g16 mt8">
                <span><span className="label">Tickets</span><br /><span className="mono">{num(f.tickets)}</span></span>
                <span><span className="label">Revenue</span><br /><span className="mono c-green">{rupees(f.revenue, { compact: true })}</span></span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}

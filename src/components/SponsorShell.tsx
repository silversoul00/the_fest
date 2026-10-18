import Link from 'next/link';
import { sql } from '@/lib/db';
import { festOpen, requestsReady } from '@/lib/sponsor-requests';
import type { User } from '@/lib/types';
import { logout } from '@/app/(auth)/actions';

/** Sponsor portal header + section links. "Requests" shows how many received requests are waiting (counted on load). */
export async function SponsorShell({ user, cur, children }: { user: User; cur: 'home' | 'fests' | 'requests' | 'profile'; children: React.ReactNode }) {
  let waiting = 0;
  if (await requestsReady()) {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int n from sponsor_requests r join fests f on f.id = r.fest_id
      where r.brand_user_id = ${user.id} and r.direction = 'org_to_brand' and r.status = 'sent'
        and ${festOpen()}`;
    waiting = r?.n ?? 0;
  }
  const link = (k: typeof cur, href: string, label: React.ReactNode) =>
    <Link href={href} className={`chip ${cur === k ? 'on' : ''}`} aria-current={cur === k ? 'page' : undefined}>{label}</Link>;
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <span className="logo">THE FEST</span>
          <div className="row g12">
            <span className="small soft hide-sm">{user.name}</span>
            <form action={logout}><button className="btn sm outline" type="submit">Log out</button></form>
          </div>
        </div>
      </header>
      <main className="wrap page stack g16" style={{ ['--accent' as string]: 'var(--blue)' }}>
        <nav className="sp-nav" aria-label="Sponsor sections">
          {link('home', '/sponsor', 'Sponsorships')}
          {link('fests', '/sponsor/fests', 'Find fests')}
          {link('requests', '/sponsor/requests', <>Requests{waiting > 0 && <span className="badge yellow req-count" style={{ marginLeft: 6 }}>{waiting}</span>}</>)}
          {link('profile', '/sponsor/profile', 'Brand profile')}
        </nav>
        {children}
      </main>
    </>
  );
}

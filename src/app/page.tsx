import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser, PORTAL } from '@/lib/auth';

const ROLES = [
  { href: '/signup?role=student', name: 'Student', icon: '🎓', color: 'var(--yellow)', desc: 'Discover fests, buy tickets, carry your QR pass' },
  { href: '/signup?role=organizer', name: 'Organizer', icon: '⚡', color: 'var(--orange)', desc: 'Run your fest — tickets, schedule, volunteers, sponsors' },
  { href: '/signup?role=sponsor', name: 'Sponsor', icon: '🏷️', color: 'var(--blue)', desc: 'Live footfall, booth visits and ROI for your brand' },
  { href: '/scan/login', name: 'Gate Scanner', icon: '📷', color: 'var(--green)', desc: 'Volunteers: validate tickets at the entry gate' },
];

export default async function Home() {
  // Role is picked once: signed-in users go straight to their portal
  const user = await getUser();
  if (user) redirect(PORTAL[user.role]);

  return (
    <main>
      <header className="topbar">
        <div className="wrap topbar-in">
          <span className="logo">THE FEST</span>
          <nav className="row g8">
            <Link href="/fests" className="btn sm outline hide-sm">Explore fests</Link>
            <Link href="/login" className="btn sm">Log in</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <span className="ghost-word" aria-hidden>FEST</span>
        <div className="wrap stack g24" style={{ position: 'relative' }}>
          <span className="kicker">Festival operating system · India</span>
          <h1 className="h1">
            Every college fest.<br />
            <span className="c-yellow">One operating system.</span>
          </h1>
          <p className="soft" style={{ maxWidth: 560, fontSize: 17 }}>
            Sell tickets, scan signed QR passes at the gate, run the schedule and volunteers,
            and show sponsors real numbers — from one app that works on every phone.
          </p>
          <div className="row g12 wrap-row">
            <Link href="/fests" className="btn">Explore fests →</Link>
            <Link href="/signup?role=organizer" className="btn outline">List your fest</Link>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 56 }}>
        <div className="label mb16">Choose your portal</div>
        <div className="grid grid-2-md" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          {ROLES.map((r) => (
            <Link key={r.name} href={r.href} className="role-card" style={{ ['--rc' as string]: r.color }}>
              <span className="ico">{r.icon}</span>
              <span className="grow">
                <span className="nm" style={{ display: 'block' }}>{r.name}</span>
                <span className="small muted">{r.desc}</span>
              </span>
              <span className="muted">→</span>
            </Link>
          ))}
        </div>

        <div className="grid mt48" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
          {[
            ['🔐', 'Tickets that can’t be faked', 'Every QR is cryptographically signed and can only get in once.'],
            ['💸', 'Free for fests', 'No setup cost. A small ₹15 convenience fee per paid ticket.'],
            ['📈', 'Sponsors see proof', 'Live footfall and booth visits instead of a PDF three weeks later.'],
          ].map(([i, t, d]) => (
            <div key={t} className="card">
              <div style={{ fontSize: 24 }}>{i}</div>
              <div className="h3 mt12">{t}</div>
              <p className="small soft mt8">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="wrap row between wrap-row g12" style={{ borderTop: '1px solid var(--border)', padding: '20px var(--gutter) 32px' }}>
        <span className="label">© THE FEST · Bengaluru</span>
        <span className="label">thefest.in</span>
      </footer>
    </main>
  );
}

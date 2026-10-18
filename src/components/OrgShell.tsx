'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type OrgFestLink = { id: string; name: string };

const TABS = [
  { seg: '', icon: '⚡', label: 'Overview' },
  { seg: '/tickets', icon: '🎟️', label: 'Tickets' },
  { seg: '/sales', icon: '💰', label: 'Sales' },
  { seg: '/analytics', icon: '📊', label: 'Analytics' },
  { seg: '/payments', icon: '🏦', label: 'Payments' },
  { seg: '/schedule', icon: '📅', label: 'Schedule' },
  { seg: '/volunteers', icon: '👥', label: 'Volunteers' },
  { seg: '/announcements', icon: '📢', label: 'Announce' },
  { seg: '/sponsors', icon: '🏷️', label: 'Sponsors' },
  { seg: '/settings', icon: '⚙️', label: 'Settings' },
];

export function OrgShell({ festId, festName, slug, status, fests, userName, isAdmin, logoutAction, badges = {}, children }: {
  badges?: Record<string, number>;
  festId: string; festName: string; slug: string; status: string; fests: OrgFestLink[]; userName: string; isAdmin?: boolean;
  logoutAction: () => Promise<void>; children: React.ReactNode;
}) {
  const path = usePathname();
  const base = `/organizer/${festId}`;
  const cur = (seg: string) => (path === base + seg ? 'page' : undefined);

  return (
    <div className="shell">
      <aside className="side">
        <Link href="/organizer" className="logo" style={{ padding: '0 12px 4px' }}>THE FEST</Link>
        <div className="label" style={{ padding: '0 12px 16px' }}>Organizer</div>
        <div className="card tight" style={{ margin: '0 4px 8px' }}>
          <div className="display truncate" style={{ fontSize: 20 }}>{festName}</div>
          <div className="row g8 mt8">
            <span className={`badge ${status === 'live' ? 'green' : status === 'review' ? 'blue' : status === 'cancelled' ? 'red' : 'gray'}`}>{status === 'review' ? 'in review' : status}</span>
            <Link href={`/fests/${slug}`} className="xs accent">View page ↗</Link>
          </div>
        </div>
        <div className="side-sep">Manage</div>
        {TABS.map((t) => (
          <Link key={t.seg} href={base + t.seg} className="side-link" aria-current={cur(t.seg)}>
            <span className="i">{t.icon}</span>{t.label}{badges[t.seg] ? <span className="badge yellow tab-count" style={{ marginLeft: 6 }}>{badges[t.seg]}</span> : null}
          </Link>
        ))}
        {fests.length > 1 && (
          <>
            <div className="side-sep">Your fests</div>
            {fests.filter((f) => f.id !== festId).map((f) => (
              <Link key={f.id} href={`/organizer/${f.id}`} className="side-link"><span className="i">↪</span><span className="truncate">{f.name}</span></Link>
            ))}
          </>
        )}
        <Link href="/organizer/new" className="side-link"><span className="i">＋</span>New fest</Link>
        <Link href="/scan/login" className="side-link"><span className="i">📷</span>Gate scanner</Link>
        {isAdmin && <Link href="/admin" className="side-link"><span className="i">🛡️</span>THE FEST admin</Link>}
        <div className="grow" />
        <div className="row g8" style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
          <span className="small truncate grow">{userName}</span>
          <form action={logoutAction}><button className="btn text xs" type="submit">Log out</button></form>
        </div>
      </aside>

      <div className="main">
        {/* Phone/tablet: compact top bar + scrollable tab strip instead of a sidebar */}
        <header className="topbar mobile-only">
          <div className="wrap topbar-in">
            <Link href="/organizer" className="logo" style={{ fontSize: 20 }}>THE FEST</Link>
            <span className="small truncate" style={{ maxWidth: '50%' }}>{festName}</span>
          </div>
        </header>
        <nav className="tabstrip" aria-label="Fest sections">
          <div className="chips">
            {TABS.map((t) => (
              <Link key={t.seg} href={base + t.seg} className={`chip ${cur(t.seg) ? 'on' : ''}`}>{t.icon} {t.label}{badges[t.seg] ? ` (${badges[t.seg]})` : ''}</Link>
            ))}
          </div>
        </nav>
        <div className="wrap" style={{ padding: '20px var(--gutter) 48px' }}>{children}</div>
      </div>
    </div>
  );
}

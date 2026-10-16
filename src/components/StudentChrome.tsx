'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/fests', icon: '🔍', label: 'Discover' },
  { href: '/tickets', icon: '🎟️', label: 'Tickets' },
  { href: '/me', icon: '👤', label: 'Profile' },
];

export function StudentChrome({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const cur = (h: string) => (path === h || path.startsWith(h + '/') ? 'page' : undefined);
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <Link href="/fests" className="logo">THE FEST</Link>
          <nav className="topnav hide-sm">
            {NAV.map((n) => <Link key={n.href} href={n.href} aria-current={cur(n.href)}>{n.label}</Link>)}
          </nav>
          {!signedIn && <Link href="/login" className="btn sm">Log in</Link>}
        </div>
      </header>
      <nav className="bottomnav" aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={cur(n.href)}>
            <span className="i">{n.icon}</span>{n.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

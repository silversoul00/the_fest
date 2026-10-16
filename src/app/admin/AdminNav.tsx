'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [['/admin', 'Overview'], ['/admin/fests', 'Fests & payouts'], ['/admin/orders', 'Orders']];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="tabstrip" style={{ top: 58 }} aria-label="Admin">
      <div className="chips wrap" style={{ padding: '10px var(--gutter)' }}>
        {TABS.map(([h, l]) => <Link key={h} href={h} className={`chip ${path === h ? 'on' : ''}`}>{l}</Link>)}
      </div>
    </nav>
  );
}

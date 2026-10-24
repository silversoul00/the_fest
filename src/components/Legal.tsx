import Link from 'next/link';

export const LEGAL_PAGES = [
  ['/legal/terms', 'Terms'],
  ['/legal/privacy', 'Privacy'],
  ['/legal/refunds', 'Refunds & cancellations'],
  ['/legal/delivery', 'Ticket delivery'],
  ['/legal/contact', 'Contact'],
] as const;

/** Business details that must be filled in before launch. Shown as a highlighted placeholder until then. */
export const BIZ = {
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || '',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || '',
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@thefest.in',
  phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || '',
  grievanceOfficer: process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER || '',
};

export function Fill({ v, what }: { v: string; what: string }) {
  return v ? <>{v}</> : <mark style={{ background: 'rgba(255,224,52,.18)', color: 'var(--yellow)', padding: '0 4px' }}>[{what} — to fill]</mark>;
}

export function SiteFooter() {
  return (
    <footer className="wrap stack g12" style={{ borderTop: '1px solid var(--border)', padding: '20px var(--gutter) 32px' }}>
      <nav className="row wrap-row g16 small">
        {LEGAL_PAGES.map(([href, label]) => <Link key={href} href={href} className="soft">{label}</Link>)}
      </nav>
      <div className="row between wrap-row g12">
        <span className="label">© THE FEST · Bengaluru</span>
        <span className="label">{BIZ.email}</span>
      </div>
    </footer>
  );
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const draft = process.env.NEXT_PUBLIC_LEGAL_FINAL !== '1';
  return (
    <main>
      <div className="wrap" style={{ maxWidth: 760, paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/" className="logo">THE FEST</Link>
        {draft && (
          <div className="alert info mt16 small">
            <b>Draft.</b> This page is a starting draft and has not been reviewed by a lawyer or CA yet. Wording may change before launch.
          </div>
        )}
        <h1 className="h2 mt24">{title}</h1>
        <p className="xs muted mt8">Last updated {updated}</p>
        <article className="legal mt24">{children}</article>
        <nav className="row wrap-row g16 small mt48" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          {LEGAL_PAGES.map(([href, label]) => <Link key={href} href={href} className="soft">{label}</Link>)}
        </nav>
      </div>
    </main>
  );
}

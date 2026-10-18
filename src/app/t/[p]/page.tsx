import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { openPublic } from '@/lib/qr2';
import { dateRange } from '@/lib/format';

/*
 * What any phone camera sees when it scans a THE FEST ticket: the basics only.
 * The sealed part of the QR is after "#", which browsers never send here — and nothing on this page reads it.
 * Any bad link (random, wrong pathTag, unknown ticket) gets the same plain 404.
 */
export const metadata = { title: 'Ticket check', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const BADGE: Record<string, [string, string]> = { valid: ['Valid', 'green'], used: ['Used', 'gray'], void: ['Cancelled', 'red'] };

export default async function PublicTicket({ params }: { params: Promise<{ p: string }> }) {
  const { p } = await params;
  let open: { ticketId: string } | null = null;
  try { open = p.length === 32 ? openPublic(p) : null; } catch { open = null; }
  if (!open) notFound();
  const [t] = await sql<{ status: string; holder_name: string; type: string; fest: string; starts_on: string; ends_on: string; college: string; city: string }[]>`
    select t.status, t.holder_name, tt.name as type, f.name as fest, f.starts_on, f.ends_on, f.college, f.city
    from tickets t join ticket_types tt on tt.id = t.ticket_type_id join fests f on f.id = t.fest_id where t.id = ${open.ticketId}`;
  if (!t) notFound();
  const [label, color] = BADGE[t.status] ?? BADGE.void;
  const first = (t.holder_name.trim().split(/\s+/)[0] ?? '').slice(0, 20);

  return (
    <main className="auth-shell">
      <div className="stack g16 narrow" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <div className="logo" style={{ textAlign: 'center' }}>THE FEST</div>
        <div className="card stack g12" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div className="label" style={{ color: 'var(--orange)' }}>{t.college} · {t.city}</div>
          <h1 className="display" style={{ fontSize: 36, margin: 0 }}>{t.fest}</h1>
          <div className="small soft">📅 {dateRange(t.starts_on, t.ends_on)}</div>
          <div className="row between g12">
            <div><div className="label">Ticket</div><div>{t.type}</div></div>
            <div style={{ textAlign: 'right' }}><div className="label">Holder</div><div>{first}</div></div>
          </div>
          <div className="row g8" style={{ alignItems: 'center' }}>
            <span className={`badge ${color}`} data-status={t.status}>{label}</span>
            <span className="xs muted">✓ Verified by THE FEST</span>
          </div>
        </div>
        <Link href="/tickets" className="btn outline block" style={{ whiteSpace: 'normal', textAlign: 'center' }}>This is your ticket? Open it in THE FEST</Link>
      </div>
    </main>
  );
}

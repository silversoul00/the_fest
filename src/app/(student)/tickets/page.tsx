import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { cutText, dateRange, rupees, todayIST } from '@/lib/format';
import { isUuid } from '@/lib/http';
import { Empty } from '@/components/ui';
import { AutoRefresh } from '@/components/AutoRefresh';

export const metadata = { title: 'My tickets' };

type Row = {
  id: string; code: string; holder_name: string; status: string; checked_in_at: Date | null;
  type_name: string; fest_name: string; slug: string; emoji: string; accent: string; college: string;
  starts_on: string; ends_on: string; order_id: string;
};

export default async function MyTickets({ searchParams }: { searchParams: Promise<{ order?: string; sent?: string }> }) {
  const user = await requireUser('student');
  const { order, sent } = await searchParams;
  // A paid event entry (v2.8) is not a ticket: its checkout lands on My events
  if (order && isUuid(order)) {
    const [ev] = await sql`select 1 from orders o join ticket_types tt on tt.id = o.ticket_type_id where o.id = ${order} and o.user_id = ${user.id} and tt.kind = 'event'`;
    if (ev) redirect('/my-events?paid=1');
  }
  const rows = await sql<Row[]>`
    select t.id, t.code, t.holder_name, t.status, t.checked_in_at, t.order_id,
           tt.name as type_name, f.name as fest_name, f.slug, f.emoji, f.accent, f.college, f.starts_on, f.ends_on
    from tickets t
    join ticket_types tt on tt.id = t.ticket_type_id
    join fests f on f.id = t.fest_id
    where t.user_id = ${user.id} and t.status <> 'void'
    order by f.starts_on asc, t.issued_at asc`;

  const pending = await sql<{ id: string; fest_name: string; qty: number; amount_paise: number; utr: string | null; review_flag: string | null }[]>`
    select o.id, f.name as fest_name, o.qty, o.amount_paise, o.utr, o.review_flag
    from orders o join fests f on f.id = o.fest_id
    where o.user_id = ${user.id} and o.method = 'upi_direct'
      and (o.status = 'pending' or (o.status = 'failed' and o.utr is not null and o.review_flag is not null and o.review_flag not like 'Rejected%'))
      and o.created_at > now() - interval '7 days'
    order by o.created_at desc`;
  const rejected = await sql<{ id: string; fest_name: string; review_flag: string }[]>`
    select o.id, f.name as fest_name, o.review_flag from orders o join fests f on f.id = o.fest_id
    where o.user_id = ${user.id} and o.method = 'upi_direct' and o.status = 'failed' and o.review_flag like 'Rejected%'
      and o.created_at > now() - interval '7 days'`;
  const refunds = await sql<{ id: string; fest_name: string; refunded_paise: number; refund_note: string | null; method: string; refund_status: string | null }[]>`
    select o.id, f.name as fest_name, o.refunded_paise, o.refund_note, o.method, o.refund_status from orders o join fests f on f.id = o.fest_id
    where o.user_id = ${user.id} and o.refunded_paise > 0 and o.refunded_at > now() - interval '30 days' order by o.refunded_at desc`;
  // "Ticket sent to …": the name comes from the transfer this student made, never from the link
  const [sentTo] = sent && isUuid(sent)
    ? await sql<{ name: string }[]>`
        select n.holder_name as name from tickets o join tickets n on n.id = o.transferred_to
        where o.id = ${sent} and o.user_id = ${user.id}`
    : [];
  const today = todayIST();
  const upcoming = rows.filter((r) => r.ends_on >= today);
  const past = rows.filter((r) => r.ends_on < today);
  const fresh = order ? rows.filter((r) => r.order_id === order) : [];

  return (
    <div className="wrap stack g16">
      <div className="row between g8 wrap-row mt8"><h1 className="h2">My tickets</h1><Link href="/my-events" className="btn sm outline">🏆 My events</Link></div>
      {pending.some((p) => p.utr) && <AutoRefresh seconds={20} stopAfterMinutes={10} />}

      {sentTo && <div className="alert ok wrap-anywhere">Ticket sent to {cutText(sentTo.name, 60)}. Their new QR is in their account.</div>}
      {fresh.length > 0 && (
        <div className="alert ok">🎉 You&apos;re in! {fresh.length} ticket{fresh.length > 1 ? 's' : ''} for {fresh[0].fest_name}. Show the QR at the gate.</div>
      )}

      {pending.map((p) => (
        <Link key={p.id} href={`/orders/${p.id}`} className="card link row g12" style={{ borderColor: 'rgba(255,224,52,.3)' }}>
          <span style={{ fontSize: 24 }}>⏳</span>
          <span className="grow">
            <strong>{p.fest_name}</strong> · {p.qty} ticket{p.qty > 1 ? 's' : ''} · <span className="mono">{rupees(p.amount_paise)}</span>
            <span className="xs muted" style={{ display: 'block' }}>
              {p.utr ? (p.review_flag ? `Organizer is checking: ${p.review_flag}` : 'UTR sent — we’ll confirm once the payment is seen in the fest’s account.') : 'Waiting for your UPI payment — tap to pay or enter the UTR'}
            </span>
          </span>
          <span className="muted">→</span>
        </Link>
      ))}
      {rejected.map((p) => (
        <div key={p.id} className="alert error">{p.fest_name}: the organizer couldn’t find your payment ({p.review_flag.replace(/^Rejected: /, '')}). If money left your account, contact the fest with your UTR.</div>
      ))}

      {refunds.map((r) => (
        <div key={r.id} className="alert info">
          {r.fest_name}: {rupees(r.refunded_paise)} refunded{r.refund_note ? ` — ${r.refund_note}` : ''}.{' '}
          {r.method === 'upi_direct' ? (r.refund_status === 'done' ? 'The organizer has sent it back by UPI.' : 'The organizer will send it back by UPI.') : 'It reaches your account in 5–7 working days.'}
        </div>
      ))}

      {rows.length === 0 && pending.length === 0 ? (
        <Empty icon="🎟️" title="No tickets yet">
          <Link className="accent" href="/fests">Find a fest →</Link>
        </Empty>
      ) : (
        <>
          <TicketList rows={upcoming} />
          {past.length > 0 && (
            <>
              <div className="label mt16">Past fests</div>
              <TicketList rows={past} dim />
            </>
          )}
        </>
      )}
    </div>
  );
}

function TicketList({ rows, dim }: { rows: Row[]; dim?: boolean }) {
  return (
    <div className="grid-auto">
      {rows.map((r) => (
        <Link key={r.id} href={`/tickets/${r.id}`} className="card link row g16" style={{ '--accent': r.accent, opacity: dim ? 0.6 : 1 } as CSSProperties}>
          <div className="fest-banner" style={{ width: 64, height: 64, flexShrink: 0, '--fest': r.accent } as CSSProperties}>
            <span className="emoji" style={{ fontSize: 30 }}>{r.emoji}</span>
          </div>
          <div className="grow">
            <div className="display truncate" style={{ fontSize: 24 }}>{r.fest_name}</div>
            <div className="xs muted truncate">{r.type_name} · {dateRange(r.starts_on, r.ends_on)}</div>
            <div className="row g8 mt8">
              {r.status === 'used'
                ? <span className="badge gray">✓ Checked in</span>
                : <span className="badge green">Valid</span>}
              <span className="mono xs muted">{r.code}</span>
            </div>
          </div>
          <span className="muted">→</span>
        </Link>
      ))}
    </div>
  );
}

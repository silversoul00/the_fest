import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { rupees } from '@/lib/format';
import { upiLink } from '@/lib/upi-parse';
import { ResumeUpi } from './ResumeUpi';

export const metadata = { title: 'Finish payment' };

// Lets a student come back to a bank-UPI order: pay, or enter the UTR later.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('student');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [o] = await sql<{ id: string; status: string; method: string; amount_paise: number; utr: string | null; review_flag: string | null; vpa: string; upi_name: string | null; fest: string; slug: string; qty: number; type: string; kind: string }[]>`
    select o.id, o.status, o.method, o.amount_paise, o.utr, o.review_flag, f.upi_vpa as vpa, f.upi_name, f.name as fest, f.slug, o.qty, tt.name as type, tt.kind
    from orders o join fests f on f.id = o.fest_id join ticket_types tt on tt.id = o.ticket_type_id
    where o.id = ${id} and o.user_id = ${user.id}`;
  if (!o) notFound();
  if (o.status === 'paid') redirect(o.kind === 'event' ? '/my-events?paid=1' : `/tickets?order=${o.id}`);

  const note = `TF ${o.id.slice(0, 8).toUpperCase()}`;
  return (
    <div className="wrap stack g16" style={{ maxWidth: 440 }}>
      <Link href="/tickets" className="label">← My tickets</Link>
      <h1 className="h2">{o.fest}</h1>
      <p className="soft small">{o.qty} × {o.type} · {rupees(o.amount_paise)}</p>
      {o.status === 'failed' && !o.utr ? (
        <div className="alert error">This order expired before payment. Seats were released — please book again.</div>
      ) : o.utr ? (
        <div className="alert info">We have your UTR <span className="mono">{o.utr}</span>. Your ticket appears as soon as the fest confirms the payment — usually within minutes.{o.review_flag ? ` Note: ${o.review_flag}` : ''}</div>
      ) : (
        <ResumeUpi upi={{ orderId: o.id, amount: o.amount_paise, vpa: o.vpa, payee: o.upi_name || o.fest, note, link: upiLink(o.vpa, o.upi_name || o.fest, o.amount_paise, note) }} />
      )}
      <Link href={`/fests/${o.slug}`} className="btn outline block">Back to fest</Link>
    </div>
  );
}

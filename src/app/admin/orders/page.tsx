import Link from 'next/link';
import { sql } from '@/lib/db';
import { ago, rupees } from '@/lib/format';
import { Empty } from '@/components/ui';

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ q?: string; flagged?: string }> }) {
  const { q = '', flagged } = await searchParams;
  const like = q.trim() ? `%${q.trim()}%` : null;
  const rows = await sql<{ id: string; created_at: Date; status: string; provider: string; method: string; amount_paise: number; refunded_paise: number; qty: number; utr: string | null; payment_ref: string | null; review_flag: string | null; name: string; email: string; fest: string; fest_id: string }[]>`
    select o.id, o.created_at, o.status, o.provider, o.method, o.amount_paise, o.refunded_paise, o.qty, o.utr, o.payment_ref, o.review_flag,
           u.name, u.email::text, f.name as fest, f.id as fest_id
    from orders o join users u on u.id = o.user_id join fests f on f.id = o.fest_id
    where true
      ${flagged ? sql`and o.review_flag is not null and o.review_flag not like 'Rejected%' and o.status <> 'paid'` : sql``}
      ${like ? sql`and (u.email ilike ${like} or u.name ilike ${like} or o.utr ilike ${like} or o.payment_ref ilike ${like} or f.name ilike ${like} or o.id::text ilike ${like})` : sql``}
    order by o.created_at desc limit 150`;

  return (
    <>
      <div className="row between wrap-row g8">
        <h1 className="h2">Orders</h1>
        <div className="chips">
          <Link href="/admin/orders" className={`chip ${!flagged ? 'on' : ''}`}>All</Link>
          <Link href="/admin/orders?flagged=1" className={`chip ${flagged ? 'on' : ''}`}>Needs a look</Link>
        </div>
      </div>
      <form className="row g8" role="search">
        {flagged && <input type="hidden" name="flagged" value="1" />}
        <input className="input grow" type="search" name="q" defaultValue={q} placeholder="Email, name, UTR, payment ID, fest, order ID" />
        <button className="btn" type="submit">Search</button>
      </form>
      {rows.length === 0 ? <Empty icon="🧾" title="No orders found" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Buyer</th><th>Fest</th><th>Payment</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id}>
                <td className="xs muted" style={{ whiteSpace: 'nowrap' }}>{ago(o.created_at)}</td>
                <td><div>{o.name}</div><div className="xs muted">{o.email}</div></td>
                <td className="small">{o.fest}</td>
                <td className="xs"><div>{o.provider}{o.method === 'upi_direct' ? ' (bank UPI)' : ''}</div><div className="mono muted">{o.utr ?? o.payment_ref ?? ''}</div></td>
                <td className="num">{rupees(o.amount_paise)}{o.refunded_paise > 0 && <div className="xs c-orange">−{rupees(o.refunded_paise)} refunded</div>}</td>
                <td><span className={`badge ${o.status === 'paid' ? 'green' : o.status === 'refunded' ? 'orange' : o.status === 'pending' ? 'yellow' : 'gray'}`}>{o.status}</span>
                  {o.review_flag && <div className="xs c-orange">{o.review_flag}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

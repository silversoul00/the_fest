import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getOwnFest } from '@/lib/queries';
import { ago, num, rupees } from '@/lib/format';
import { Empty, Stat } from '@/components/ui';
import { ActionForm, Submit } from '@/components/forms';
import { markUpiRefundSent, refundOrderAction } from '../../actions';

export default async function Sales({ params, searchParams }: { params: Promise<{ festId: string }>; searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const { q = '' } = await searchParams;
  const like = q.trim() ? `%${q.trim()}%` : null;

  const [byType, orders] = await Promise.all([
    sql<{ name: string; qty: number; gross: number; fees: number }[]>`
      select tt.name, (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status <> 'void')::int qty,
             coalesce(sum(o.amount_paise - o.refunded_paise), 0)::int gross, coalesce(sum(o.platform_fee_paise + o.gateway_fee_paise), 0)::int fees
      from ticket_types tt left join orders o on o.ticket_type_id = tt.id and o.status in ('paid', 'refunded')
      where tt.fest_id = ${fest.id} group by tt.id, tt.name, tt.sort order by tt.sort`,
    sql<{ id: string; created_at: Date; qty: number; amount_paise: number; platform_fee_paise: number; provider: string; status: string; refunded_paise: number; refund_status: string | null; unused: number; utr: string | null; name: string; email: string; college: string | null; type: string }[]>`
      select o.id, o.paid_at as created_at, o.qty, o.amount_paise, o.platform_fee_paise, o.provider, o.status, o.refunded_paise, o.refund_status, o.utr,
             (select count(*) from tickets t where t.order_id = o.id and t.status = 'valid')::int as unused,
             u.name, u.email::text, u.college, tt.name as type
      from orders o join users u on u.id = o.user_id join ticket_types tt on tt.id = o.ticket_type_id
      where o.fest_id = ${fest.id} and o.status in ('paid', 'refunded')
        ${like ? sql`and (u.name ilike ${like} or u.email ilike ${like} or u.college ilike ${like})` : sql``}
      order by o.paid_at desc limit 200`,
  ]);

  const totals = byType.reduce((a, t) => ({ qty: a.qty + t.qty, gross: a.gross + t.gross, fees: a.fees + t.fees }), { qty: 0, gross: 0, fees: 0 });

  return (
    <div className="stack g16">
      <div className="row between wrap-row g8">
        <h1 className="h2">Sales</h1>
        <a className="btn sm outline" href={`/organizer/${fest.id}/export`} download>⬇ Export CSV</a>
      </div>

      <div className="grid-2 grid-3">
        <Stat label="Tickets" value={num(totals.qty)} />
        <Stat label="Collected" value={rupees(totals.gross, { compact: true })} color="var(--blue)" sub="incl. convenience fees" />
        <Stat label="Your payout" value={rupees(totals.gross - totals.fees, { compact: true })} color="var(--green)" sub={`${rupees(totals.fees, { compact: true })} fees & payment charges`} />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Ticket type</th><th className="num">Sold</th><th className="num">Collected</th><th className="num">Payout</th></tr></thead>
          <tbody>
            {byType.map((t) => (
              <tr key={t.name}><td>{t.name}</td><td className="num">{num(t.qty)}</td><td className="num">{rupees(t.gross)}</td><td className="num c-green">{rupees(t.gross - t.fees)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {orders.some((o) => o.refund_status === 'manual_pending') && (
        <div className="card stack g8" style={{ borderColor: 'rgba(56,189,248,.35)' }}>
          <div className="h3">UPI refunds to send</div>
          <p className="xs muted">These students paid your fest’s UPI directly. Send the amount back from your bank app (to the UPI ID that paid, found by its UTR), then mark it sent.</p>
          {orders.filter((o) => o.refund_status === 'manual_pending').map((o) => (
            <div key={o.id} className="row wrap-row g12 small">
              <span className="grow">{o.name} · {o.email} · UTR <span className="mono">{o.utr ?? '—'}</span></span>
              <span className="mono">{rupees(o.refunded_paise)}</span>
              {fest.is_owner && <form action={markUpiRefundSent}><input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="orderId" value={o.id} /><button className="btn sm blue">Mark sent</button></form>}
            </div>
          ))}
        </div>
      )}

      <form className="row g8" role="search">
        <input className="input grow" type="search" name="q" defaultValue={q} placeholder="Search buyer, email, college" />
        <button className="btn" type="submit">Search</button>
      </form>

      {orders.length === 0 ? <Empty icon="💸" title={q ? 'No matching orders' : 'No sales yet'}>{q ? '' : 'Share your fest link to start selling.'}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Buyer</th><th>Ticket</th><th className="num">Qty</th><th className="num">Amount</th><th>When</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><div>{o.name}</div><div className="xs muted">{o.email}{o.college ? ` · ${o.college}` : ''}</div></td>
                  <td className="small">{o.type}{o.provider === 'demo' && <span className="badge gray" style={{ marginLeft: 6 }}>demo</span>}</td>
                  <td className="num">{o.qty}</td>
                  <td className="num">{rupees(o.amount_paise)}{o.refunded_paise > 0 && <div className="xs c-orange">−{rupees(o.refunded_paise)} refunded</div>}</td>
                  <td className="xs muted" style={{ whiteSpace: 'nowrap' }}>{ago(o.created_at)}</td>
                  <td style={{ minWidth: 120 }}>
                    {o.status === 'refunded' ? <span className="badge orange">Refunded</span> : !fest.is_owner ? null : o.unused > 0 ? (
                      <details>
                        <summary className="xs c-red" style={{ cursor: 'pointer' }}>Cancel / refund</summary>
                        <ActionForm action={refundOrderAction} className="form mt8">
                          <input type="hidden" name="festId" value={fest.id} />
                          <input type="hidden" name="orderId" value={o.id} />
                          <label className="field"><span>Tickets to cancel (of {o.unused} unused)</span>
                            <input className="input" type="number" name="tickets" min={1} max={o.unused} defaultValue={o.unused} /></label>
                          <label className="field"><span>Reason (student sees this)</span><input className="input" name="reason" placeholder="Requested by student" /></label>
                          <Submit className="btn sm danger">Cancel &amp; refund</Submit>
                          {o.provider === 'upi_direct' && <p className="xs muted">Paid by bank UPI — you’ll send the money back yourself.</p>}
                        </ActionForm>
                      </details>
                    ) : <span className="xs muted">All used</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getOwnFest } from '@/lib/queries';
import { ago, rupees } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty, Stat } from '@/components/ui';
import { confirmUpiOrder, pasteAlerts, rejectUpiOrder, rotateInboundToken, saveUpiSettings, uploadStatement } from '../../actions';
import { PasteAlertsForm, UploadStatementForm } from './CreditForms';

export default async function Payments({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';

  const [review, waiting, counts, credits] = await Promise.all([
    sql<{ id: string; amount_paise: number; utr: string | null; utr_submitted_at: Date | null; review_flag: string | null; status: string; name: string; email: string; qty: number; type: string; created_at: Date }[]>`
      select o.id, o.amount_paise, o.utr, o.utr_submitted_at, o.review_flag, o.status, u.name, u.email::text, o.qty, tt.name as type, o.created_at
      from orders o join users u on u.id = o.user_id join ticket_types tt on tt.id = o.ticket_type_id
      where o.fest_id = ${fest.id} and o.method = 'upi_direct'
        and ((o.status = 'pending' and o.utr is not null) or (o.status in ('pending','failed') and o.review_flag is not null and o.review_flag not like 'Rejected%'))
      order by o.utr_submitted_at nulls last, o.created_at`,
    sql<{ n: number }[]>`select count(*)::int n from orders where fest_id = ${fest.id} and method = 'upi_direct' and status = 'pending' and utr is null`,
    sql<{ confirmed: number; amount: number }[]>`
      select count(*)::int confirmed, coalesce(sum(amount_paise), 0)::int amount from orders
      where fest_id = ${fest.id} and method = 'upi_direct' and status = 'paid'`,
    sql<{ id: number; utr: string | null; amount_paise: number; source: string; matched_order_id: string | null; created_at: Date }[]>`
      select id, utr, amount_paise, source, matched_order_id, created_at from upi_credits where fest_id = ${fest.id} order by created_at desc limit 15`,
  ]);

  return (
    <div className="stack g16">
      <h1 className="h2">Payments</h1>

      <div className="card stack g12">
        <div className="h3">Zero-fee UPI</div>
        <p className="small soft">Students pay your fest’s own UPI ID directly — no payment-gateway charges. Each order gets a unique amount (like ₹270.37) so THE FEST can match it. Use the college or fest committee’s <strong>current account</strong> UPI ID, not a personal one.</p>
        <ActionForm action={saveUpiSettings}>
          <input type="hidden" name="festId" value={fest.id} />
          <label className="check"><input type="checkbox" name="upi_enabled" defaultChecked={fest.upi_enabled} /> Accept zero-fee UPI for this fest</label>
          <div className="form-row">
            <label className="field"><span>Fest UPI ID</span><input className="input mono" name="upi_vpa" defaultValue={fest.upi_vpa ?? ''} placeholder="neonutsav@icici" autoCapitalize="none" /></label>
            <label className="field"><span>Name shown in UPI apps</span><input className="input" name="upi_name" defaultValue={fest.upi_name ?? fest.name} /></label>
          </div>
          <Submit className="btn">Save</Submit>
        </ActionForm>
      </div>

      {fest.upi_enabled && (
        <>
          <div className="grid-2 grid-3">
            <Stat label="Confirmed UPI orders" value={counts[0].confirmed} sub={rupees(counts[0].amount, { compact: true }) + ' received'} color="var(--green)" />
            <Stat label="Need your check" value={review.length} color={review.length ? 'var(--orange)' : 'var(--dim)'} sub="UTR entered, payment not matched yet" />
            <Stat label="Waiting for payment" value={waiting[0].n} color="var(--blue)" sub="released after 30 min if unpaid" />
          </div>

          <div className="card">
            <div className="card-head"><span className="h3">Needs a check</span></div>
            {review.length === 0 ? <Empty icon="✅" title="All clear">Every UPI payment so far has been matched.</Empty> : (
              <div className="stack g8">
                {review.map((o) => (
                  <div key={o.id} className="card tight row wrap-row g12" style={{ background: 'var(--black)' }}>
                    <div className="grow" style={{ minWidth: 200 }}>
                      <div><strong>{o.name}</strong> <span className="xs muted">{o.email}</span></div>
                      <div className="small">{o.qty} × {o.type} · <span className="mono">{rupees(o.amount_paise)}</span> · UTR <span className="mono">{o.utr ?? '—'}</span></div>
                      <div className="xs muted">{o.review_flag ? <span className="c-orange">{o.review_flag}</span> : `Submitted ${ago(o.utr_submitted_at ?? o.created_at)} — not in any statement or alert yet`}</div>
                    </div>
                    <form action={confirmUpiOrder}><input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="orderId" value={o.id} /><button className="btn sm green">Confirm</button></form>
                    <form action={rejectUpiOrder}><input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="orderId" value={o.id} /><button className="btn sm danger">Reject</button></form>
                  </div>
                ))}
                <p className="xs muted">Confirm only after you see the money in the bank account with that UTR and amount. Reject frees the seats again.</p>
              </div>
            )}
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
            <div className="card stack g12">
              <div className="h3">Paste bank alerts</div>
              <p className="xs muted">Copy the credit SMS or emails from your bank and paste them here. Fastest way during ticket sales.</p>
              <PasteAlertsForm festId={fest.id} action={pasteAlerts} />
            </div>
            <div className="card stack g12">
              <div className="h3">Upload statement</div>
              <p className="xs muted">Download today’s statement from net banking as CSV or Excel and upload it. Catches anything the alerts missed.</p>
              <UploadStatementForm festId={fest.id} action={uploadStatement} />
            </div>
          </div>

          <div className="card stack g8">
            <div className="h3">Automatic: forward bank alert emails</div>
            <p className="xs muted">Bank alert emails can be forwarded to THE FEST automatically through an email service (e.g. Cloudflare Email Routing or Postmark inbound) that posts each email to this private link. Confirmations then happen within a minute. Treat the link like a password.</p>
            {fest.inbound_token
              ? <div className="mono small accent" style={{ wordBreak: 'break-all' }}>{site}/api/upi/inbound/{fest.inbound_token}</div>
              : <p className="small soft">No link yet.</p>}
            <form action={rotateInboundToken}><input type="hidden" name="festId" value={fest.id} /><button className="btn sm outline">{fest.inbound_token ? 'Reset link' : 'Create link'}</button></form>
          </div>

          <div className="card">
            <div className="card-head"><span className="label">Recent bank credits seen</span></div>
            {credits.length === 0 ? <p className="small muted">None yet.</p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>When</th><th>UTR</th><th className="num">Amount</th><th>From</th><th>Status</th></tr></thead>
                <tbody>{credits.map((c) => (
                  <tr key={c.id}><td className="xs muted">{ago(c.created_at)}</td><td className="mono xs">{c.utr ?? '—'}</td><td className="num">{rupees(c.amount_paise)}</td><td className="xs">{c.source}</td>
                    <td>{c.matched_order_id ? <span className="badge green">Matched</span> : <span className="badge gray">Not matched</span>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

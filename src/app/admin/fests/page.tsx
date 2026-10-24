import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { festMoney } from '@/lib/admin-queries';
import { ago, num, rupees } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { FestStatus } from '@/components/ui';
import { recordPayout } from '../actions';

export default async function AdminFests() {
  // Every admin page checks for itself: layouts don't run on client-side navigation requests.
  await requireAdmin();
  const [money, payouts] = await Promise.all([
    festMoney(),
    sql<{ id: string; name: string; amount_paise: number; reference: string | null; note: string | null; created_at: Date }[]>`
      select p.id, f.name, p.amount_paise, p.reference, p.note, p.created_at from payouts p join fests f on f.id = p.fest_id order by p.created_at desc limit 20`,
  ]);

  return (
    <>
      <h1 className="h2">Fests &amp; payouts</h1>
      <p className="small soft">
        <strong>Balance</strong> = card/UPI-gateway money you collected for the fest, minus your fee and gateway charges, minus refunds,
        minus fees the fest owes you on zero-fee UPI tickets, minus payouts already made. Positive → transfer to the fest. Negative → the fest owes you.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Fest</th><th>Status</th><th className="num">Tickets</th><th className="num">Sales</th><th className="num">Your fees</th><th className="num">Paid out</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {money.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/fests/${f.slug}`} className="accent">{f.name}</Link><div className="xs muted">{f.organizer} · {f.organizer_email}</div>{f.demo_orders > 0 && <div className="xs muted">{f.demo_orders} demo orders (not real money)</div>}</td>
                <td><FestStatus fest={f as never} /></td>
                <td className="num">{num(f.tickets)}</td>
                <td className="num">{rupees(f.gmv)}</td>
                <td className="num">{rupees(f.fee_revenue)}</td>
                <td className="num">{rupees(f.paid_out)}</td>
                <td className={`num ${f.balance > 0 ? 'c-orange' : f.balance < 0 ? 'c-blue' : ''}`}>{f.balance < 0 ? `owes you ${rupees(-f.balance)}` : rupees(f.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card stack g12">
        <div className="h3">Record a payout</div>
        <p className="xs muted">After you transfer money to a fest’s bank account, record it here so balances stay right.</p>
        <ActionForm action={recordPayout} resetOnSuccess>
          <div className="form-row">
            <label className="field"><span>Fest</span>
              <select className="select" name="festId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {money.map((f) => <option key={f.id} value={f.id}>{f.name}{f.balance > 0 ? ` — owed ${rupees(f.balance)}` : ''}</option>)}
              </select>
            </label>
            <label className="field"><span>Amount (₹)</span><input className="input" name="amount" type="number" min={1} step="0.01" required /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>Bank reference (UTR)</span><input className="input mono" name="reference" /></label>
            <label className="field"><span>Note</span><input className="input" name="note" /></label>
          </div>
          <Submit className="btn">Record payout</Submit>
        </ActionForm>
      </div>

      {payouts.length > 0 && (
        <div className="list">
          {payouts.map((p) => (
            <div key={p.id} className="li"><span className="grow"><strong>{p.name}</strong> <span className="xs muted">{p.reference ?? ''} {p.note ?? ''}</span></span><span className="mono">{rupees(p.amount_paise)}</span><span className="xs muted">{ago(p.created_at)}</span></div>
          ))}
        </div>
      )}
    </>
  );
}

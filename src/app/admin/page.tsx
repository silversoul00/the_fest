import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { festMoney } from '@/lib/admin-queries';
import { dateRange, num, rupees } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty, Stat } from '@/components/ui';
import { approveFest, sendBackFest } from './actions';
import { appEnv, configProblems, configWarnings } from '@/lib/env';
import { gatewayLabel } from '@/lib/payments';
import { checkTicketKeys } from '@/lib/ticket-crypto';

/** Admin-only: how the app is set up right now. Names of settings only, never their values. */
async function SystemCard() {
  const problems = configProblems();
  const warnings = configWarnings();
  const keys = checkTicketKeys();
  const [{ errs }] = await sql<{ errs: number }[]>`select count(*)::int errs from app_errors where at > now() - interval '24 hours'`;
  const gw = gatewayLabel();
  const rows: [string, string, boolean][] = [
    ['Database', 'up', true],
    ['Card/UPI gateway', gw, gw.endsWith('live') || (appEnv() !== 'production' && gw !== 'none')],
    ['Email', process.env.RESEND_API_KEY ? 'resend' : 'not configured (kept in outbox)', !!process.env.RESEND_API_KEY],
    ['Ticket signing keys', keys === 'ok' ? 'OK' : keys, keys === 'ok'],
    ['Environment', appEnv(), true],
    ['Errors (24h)', String(errs), errs === 0],
  ];
  return (
    <section className="card stack g8" aria-label="System">
      <div className="row between"><h2 className="h3">System</h2>
        <span className={`badge ${problems.length ? 'red' : 'green'}`}>{problems.length ? `${problems.length} to fix` : 'all good'}</span></div>
      <div className="stack g4 small">
        {rows.map(([k, v, ok]) => (
          <div key={k} className="row between g8"><span className="soft">{k}</span><span className={`mono ${ok ? 'c-green' : 'c-orange'}`} style={{ textAlign: 'right' }}>{v}</span></div>
        ))}
      </div>
      {problems.length > 0 && <div className="alert error" style={{ wordBreak: 'break-word' }}>Fix in Vercel → Settings → Environment Variables, then redeploy: {problems.join(', ')}</div>}
      {warnings.length > 0 && <div className="alert info" style={{ wordBreak: 'break-word' }}>Heads-up: {warnings.join(', ')}{warnings.includes('NO_LIVE_GATEWAY') ? ' — card/UPI checkout is off; bank UPI and free tickets still work.' : ''}</div>}
      {errs > 0 && <Link className="accent small" href="/admin/errors">See errors →</Link>}
    </section>
  );
}

export default async function AdminHome() {
  // Every admin page checks for itself: layouts don't run on client-side navigation requests.
  await requireAdmin();
  const [money, review, [counts], flagged] = await Promise.all([
    festMoney(),
    sql<{ id: string; name: string; slug: string; college: string; city: string; starts_on: string; ends_on: string; organizer: string; email: string; phone: string | null; types: number; min_price: number | null; created_at: Date; description: string }[]>`
      select f.id, f.name, f.slug, f.college, f.city, f.starts_on, f.ends_on, u.name as organizer, u.email::text as email, u.phone, f.created_at, f.description,
        (select count(*) from ticket_types t where t.fest_id = f.id and t.active)::int as types,
        (select min(price_paise) from ticket_types t where t.fest_id = f.id and t.active)::int as min_price
      from fests f join users u on u.id = f.organizer_id where f.status = 'review' order by f.created_at`,
    sql<{ live: number; users: number; orders_today: number }[]>`
      select (select count(*) from fests where status = 'live')::int live,
             (select count(*) from users)::int users,
             (select count(*) from orders where status = 'paid' and paid_at > now() - interval '24 hours')::int orders_today`,
    sql<{ n: number }[]>`select count(*)::int n from orders where review_flag is not null and review_flag not like 'Rejected%' and status <> 'paid'`,
  ]);
  const t = money.reduce((a, f) => ({ gmv: a.gmv + f.gmv, fee: a.fee + f.fee_revenue, owe: a.owe + Math.max(0, f.balance), due: a.due + Math.max(0, -f.balance) }), { gmv: 0, fee: 0, owe: 0, due: 0 });

  return (
    <>
      <h1 className="h2">Overview</h1>
      <div className="grid-2 grid-4">
        <Stat label="THE FEST fee revenue" value={rupees(t.fee, { compact: true })} sub="real payments only" color="var(--green)" />
        <Stat label="Ticket sales (GMV)" value={rupees(t.gmv, { compact: true })} sub={`${num(counts.orders_today)} orders in 24h`} />
        <Stat label="You owe fests" value={rupees(t.owe, { compact: true })} sub="card/UPI gateway money to pay out" color="var(--orange)" />
        <Stat label="Fests owe you" value={rupees(t.due, { compact: true })} sub="fees on zero-fee UPI tickets" color="var(--blue)" />
      </div>
      <div className="row g12 wrap-row small soft">
        <span>{counts.live} fests live</span><span>·</span><span>{num(counts.users)} users</span><span>·</span>
        <Link className="accent" href="/admin/orders?flagged=1">{flagged[0].n} payments need a look →</Link>
      </div>

      <SystemCard />

      <h2 className="h3 mt16">Waiting for approval ({review.length})</h2>
      {review.length === 0 ? <Empty icon="✅" title="Nothing to review" /> : review.map((f) => (
        <div key={f.id} className="card stack g12">
          <div className="row between wrap-row g8">
            <div>
              <div className="display" style={{ fontSize: 26 }}>{f.name}</div>
              <div className="small soft">{f.college}, {f.city} · {dateRange(f.starts_on, f.ends_on)}</div>
              <div className="xs muted">Organizer: {f.organizer} · {f.email}{f.phone ? ` · ${f.phone}` : ''} · {f.types} ticket type{f.types === 1 ? '' : 's'} from {f.min_price ? rupees(f.min_price) : 'free'}</div>
            </div>
            <Link className="btn sm outline" href={`/fests/${f.slug}`} target="_blank">Preview ↗</Link>
          </div>
          {f.description && <p className="small soft" style={{ whiteSpace: 'pre-line' }}>{f.description.slice(0, 400)}</p>}
          <p className="xs muted">Check before approving: the college and dates are real (search the fest name, check the college’s Instagram), the organizer can be reached, prices look normal.</p>
          <div className="row g12 wrap-row" style={{ alignItems: 'flex-start' }}>
            <form action={approveFest}><input type="hidden" name="festId" value={f.id} /><button className="btn green">Approve — go live</button></form>
            <div className="grow" style={{ minWidth: 260 }}>
              <ActionForm action={sendBackFest} className="row g8">
                <input type="hidden" name="festId" value={f.id} />
                <input className="input grow" name="note" placeholder="What should they fix?" />
                <Submit className="btn outline">Send back</Submit>
              </ActionForm>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

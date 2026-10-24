import Link from 'next/link';
import { pageAccess } from '@/lib/fest-access';
import { festAnalytics } from '@/lib/analytics';
import { num, rupees, shortDate } from '@/lib/format';
import { Empty, Stat } from '@/components/ui';
import { BarList, ColumnChart, LineChart } from '@/components/charts';

export const metadata = { title: 'Analytics' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
const hourLong = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const METHOD: Record<string, string> = { gateway: 'Card / UPI checkout', upi_direct: 'Zero-fee UPI to the fest', free: 'Free tickets' };
const PROBLEM: Record<string, string> = {
  duplicate: 'Already used (copied QR)', invalid: 'Fake or unreadable QR', wrong_fest: 'Ticket for another fest', void: 'Cancelled or transferred ticket',
};

function Card({ title, sub, children, table }: { title: string; sub?: string; children: React.ReactNode; table?: React.ReactNode }) {
  return (
    <section className="card">
      <div className="h3">{title}</div>
      {sub && <p className="xs muted mt8">{sub}</p>}
      <div className="mt16">{children}</div>
      {table && (
        <details className="viz-details">
          <summary>Show as table</summary>
          {table}
        </details>
      )}
    </section>
  );
}

export default async function Analytics({ params }: { params: Promise<{ festId: string }> }) {
  const { fest } = await pageAccess((await params).festId, 'analytics');
  const a = await festAnalytics(fest.id);
  const t = a.totals;
  const capacity = t.capacity && t.capacity > 0 ? t.capacity : t.quota;

  if (t.tickets === 0 && a.entries.length === 0) {
    return (
      <div className="stack g16">
        <h1 className="h2">Analytics</h1>
        <Empty icon="📊" title="No sales yet">Charts appear here once the first ticket is sold. Share your fest link to get started.</Empty>
      </div>
    );
  }

  const sales = a.salesDays.map((d) => ({
    key: d.d, label: shortDate(d.d), value: d.total,
    tip: `${WEEKDAYS[new Date(`${d.d}T00:00:00+05:30`).getUTCDay()]} ${shortDate(d.d)} · ${d.qty} sold that day`,
  }));
  const bestDay = a.salesDays.reduce<{ d: string; qty: number } | null>((p, d) => (!p || d.qty > p.qty ? d : p), null);
  const entryPoints = a.entries.map((e) => {
    const [day, hh] = e.h.split('T');
    const h = Number(hh);
    return { key: e.h, label: h % 3 === 0 ? hourLabel(h) : '', value: e.n, tip: `${shortDate(day)}, ${hourLong(h)}–${hourLong((h + 1) % 24)}` };
  });
  const buyPoints = a.buyByHour.map((b) => ({ key: String(b.h), label: hourLabel(b.h), value: b.qty, tip: `${hourLong(b.h)}–${hourLong((b.h + 1) % 24)}` }));
  const topBuyHour = a.buyByHour.reduce((p, b) => (b.qty > p.qty ? b : p), a.buyByHour[0]);
  const ticketsTotal = a.methods.reduce((s, m) => s + m.tickets, 0);
  const problemsTotal = a.problems.reduce((s, p) => s + p.n, 0);
  const noShows = t.started ? t.tickets - t.used : 0;

  return (
    <div className="stack g16">
      <div className="row between wrap-row g8">
        <div>
          <h1 className="h2">Analytics</h1>
          <p className="xs muted mt8">All times IST · updated when you open this page</p>
        </div>
        <a className="btn sm outline" href={`/organizer/${fest.id}/export`}>Download attendee CSV</a>
      </div>

      <div className="kpi-grid">
        <Stat label="Tickets sold" value={num(t.tickets)} sub={capacity ? `${pct(t.tickets, capacity)}% of ${num(capacity)} capacity` : `${num(t.orders)} orders`} />
        <Stat label="Your revenue" value={rupees(t.net, { compact: true })} sub={`after fees · ${rupees(t.gross, { compact: true })} collected`} color="var(--green)" />
        <Stat
          label="Showed up" value={t.started ? `${pct(t.used, t.tickets)}%` : '—'} color="var(--blue)"
          sub={t.started ? `${num(t.used)} in · ${num(noShows)} no-shows` : 'shows once the fest starts'}
        />
        <Stat label="Per order" value={t.orders ? (t.tickets / t.orders).toFixed(1) : '—'} sub={t.refund_orders ? `${t.refund_orders} refunded · ${rupees(t.refunded, { compact: true })}` : 'tickets per purchase'} color="var(--orange)" />
      </div>

      <div className="an-grid two">
        <Card
          title="Sales pace"
          sub={bestDay && bestDay.qty > 0 ? `Tickets sold so far, day by day. Best day: ${shortDate(bestDay.d)} with ${num(bestDay.qty)}.` : 'Tickets sold so far, day by day.'}
          table={
            <table className="viz-table"><thead><tr><th>Day</th><th className="n">Sold</th><th className="n">Total</th></tr></thead>
              <tbody>{[...a.salesDays].reverse().map((d) => <tr key={d.d}><td>{shortDate(d.d)}</td><td className="n">{num(d.qty)}</td><td className="n">{num(d.total)}</td></tr>)}</tbody></table>
          }
        >
          {sales.length > 0 ? <LineChart data={sales} unit="tickets sold" /> : <p className="small muted">No paid sales yet.</p>}
        </Card>

        <Card
          title="Ticket types"
          sub="Sold against each type's limit. Tap or hover a row for what it brought in."
          table={
            <table className="viz-table"><thead><tr><th>Type</th><th className="n">Price</th><th className="n">Sold</th><th className="n">Limit</th><th className="n">Collected</th></tr></thead>
              <tbody>{a.types.map((ty) => <tr key={ty.name}><td>{ty.name}{!ty.active && <span className="muted"> (off)</span>}</td><td className="n">{rupees(ty.price)}</td><td className="n">{num(ty.sold)}</td><td className="n">{num(ty.quota)}</td><td className="n">{rupees(ty.revenue)}</td></tr>)}</tbody></table>
          }
        >
          <BarList
            unit="sold"
            rows={a.types.map((ty) => ({
              key: ty.name, label: `${ty.name}${ty.price ? ` · ${rupees(ty.price)}` : ' · Free'}`, value: ty.sold, of: ty.quota,
              note: `${pct(ty.sold, ty.quota)}% sold · ${rupees(ty.revenue)} collected${t.started ? ` · ${pct(ty.used, ty.sold)}% showed up` : ''}`,
            }))}
          />
        </Card>
      </div>

      <Card
        title="Gate entries by hour"
        sub={a.peakEntry ? `Busiest hour: ${shortDate(a.peakEntry.h.slice(0, 10))}, ${hourLong(Number(a.peakEntry.h.slice(11)))} with ${num(a.peakEntry.n)} people. Put more volunteers on the gates around then next time.` : 'Appears once tickets are scanned at the gate.'}
        table={a.entries.length > 0 ? (
          <table className="viz-table"><thead><tr><th>Hour</th><th className="n">Entered</th></tr></thead>
            <tbody>{a.entries.filter((e) => e.n > 0).map((e) => <tr key={e.h}><td>{shortDate(e.h.slice(0, 10))}, {hourLong(Number(e.h.slice(11)))}</td><td className="n">{num(e.n)}</td></tr>)}</tbody></table>
        ) : undefined}
      >
        {a.entries.length > 0
          ? <ColumnChart data={entryPoints} unit="entered" />
          : <p className="small muted">No one has been scanned in yet.</p>}
        {a.gates.length > 1 && (
          <div className="mt16">
            <div className="label mb8">By gate</div>
            <BarList unit="entered" rows={a.gates.map((g) => ({ key: g.gate, label: g.gate, value: g.n }))} />
          </div>
        )}
      </Card>

      <div className="an-grid two">
        <Card
          title="Where your audience comes from"
          sub={`${num(a.collegeCount)} college${a.collegeCount === 1 ? '' : 's'}${t.host_share !== null ? ` · ${Math.round((1 - t.host_share) * 100)}% from outside ${t.host_college}` : ''}. Useful when you pitch sponsors.`}
          table={
            <table className="viz-table"><thead><tr><th>College</th><th className="n">Tickets</th><th className="n">Share</th></tr></thead>
              <tbody>{a.collegeRows.map((c) => <tr key={c.college}><td>{c.college}</td><td className="n">{num(c.n)}</td><td className="n">{pct(c.n, t.tickets)}%</td></tr>)}</tbody></table>
          }
        >
          <BarList unit="tickets" rows={a.collegeRows.map((c) => ({ key: c.college, label: c.college, value: c.n, note: `${pct(c.n, t.tickets)}% of tickets` }))} />
        </Card>

        <Card
          title="When students buy"
          sub={topBuyHour && topBuyHour.qty > 0 ? `Most tickets are bought around ${hourLong(topBuyHour.h)}. Post announcements and reminders just before then.` : 'Hour of day tickets were bought.'}
          table={
            <table className="viz-table"><thead><tr><th>Hour</th><th className="n">Tickets</th></tr></thead>
              <tbody>{a.buyByHour.filter((b) => b.qty > 0).map((b) => <tr key={b.h}><td>{hourLong(b.h)}</td><td className="n">{num(b.qty)}</td></tr>)}</tbody></table>
          }
        >
          <ColumnChart data={buyPoints} unit="tickets" labelEvery={3} height={140} />
        </Card>
      </div>

      <div className="an-grid two">
        <Card
          title="How people paid"
          sub="Zero-fee UPI saves students the payment charges."
          table={
            <table className="viz-table"><thead><tr><th>Method</th><th className="n">Orders</th><th className="n">Tickets</th><th className="n">Collected</th></tr></thead>
              <tbody>{a.methods.map((m) => <tr key={m.method}><td>{METHOD[m.method] ?? m.method}</td><td className="n">{num(m.orders)}</td><td className="n">{num(m.tickets)}</td><td className="n">{rupees(m.amount)}</td></tr>)}</tbody></table>
          }
        >
          {a.methods.length > 1
            ? <BarList unit="tickets" rows={a.methods.map((m) => ({ key: m.method, label: METHOD[m.method] ?? m.method, value: m.tickets, note: `${pct(m.tickets, ticketsTotal)}% of tickets · ${rupees(m.amount)} collected` }))} />
            : a.methods[0]
              ? <p className="small soft">All {num(a.methods[0].tickets)} tickets were bought through <b>{METHOD[a.methods[0].method] ?? a.methods[0].method}</b> ({rupees(a.methods[0].amount)} collected).{a.methods[0].method === 'gateway' ? ' Turn on zero-fee UPI in Payments to save students the payment charges.' : ''}</p>
              : <p className="small muted">No payments yet.</p>}
        </Card>

        <Card title="Blocked at the gate" sub="Scans the app refused. A high “already used” count means QR screenshots are being shared.">
          {problemsTotal === 0 ? <p className="small muted">Nothing blocked{a.entries.length ? ' — every scan was a valid ticket.' : ' yet.'}</p> : (
            <table className="viz-table">
              <thead><tr><th>Reason</th><th className="n">Scans</th></tr></thead>
              <tbody>{a.problems.map((p) => <tr key={p.result}><td>{PROBLEM[p.result] ?? p.result}</td><td className="n">{num(p.n)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>

      <p className="xs muted">Need the raw data? <Link className="accent" href={`/organizer/${fest.id}/sales`}>Sales</Link> lists every order, and the CSV has every ticket.</p>
    </div>
  );
}

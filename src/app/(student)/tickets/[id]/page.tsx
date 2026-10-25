import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { dateRange, time } from '@/lib/format';
import { sealTicket, ticketSealData } from '@/lib/qr2';
import { siteUrlOrNull } from '@/lib/env';
import { LiveQR } from '@/components/LiveQR';
import { reportError } from '@/lib/errors';
import { isUuid } from '@/lib/http';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ActionForm, Submit } from '@/components/forms';
import { todayIST } from '@/lib/format';
import { transferAction } from '../actions';
import { getTicketTypes } from '@/lib/queries';
import { activeGateway, feeConfig } from '@/lib/payments';
import { BuyTickets } from '../../fests/[slug]/BuyTickets';

export const metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('student');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [t] = await sql<{
    id: string; code: string; holder_name: string; status: string; checked_in_at: Date | null; gate: string | null; fest_id: string;
    type_name: string; fest_name: string; slug: string; college: string; venue: string | null; city: string; starts_on: string; ends_on: string;
    void_reason: string | null; fest_status: string; allow_transfers: boolean; upi_ok: boolean;
  }[]>`
    select t.id, t.code, t.holder_name, t.status, t.checked_in_at, t.gate, t.fest_id,
           tt.name as type_name, f.name as fest_name, f.slug, f.college, f.venue, f.city, f.starts_on, f.ends_on,
           t.void_reason, f.status as fest_status, f.allow_transfers, (f.upi_enabled and f.upi_vpa is not null) as upi_ok
    from tickets t join ticket_types tt on tt.id = t.ticket_type_id join fests f on f.id = t.fest_id
    where t.id = ${id} and t.user_id = ${user.id}`;
  if (!t) notFound();
  if (t.status === 'void') {
    return (
      <div className="wrap stack g16" style={{ maxWidth: 440 }}>
        <Link href="/tickets" className="label">← My tickets</Link>
        <div className="card stack g8">
          <div className="h3">{t.fest_name} · {t.type_name}</div>
          <p className="small soft">This ticket is no longer valid{t.void_reason ? ` — ${t.void_reason}` : ''}. Its QR code won’t scan.</p>
        </div>
      </div>
    );
  }
  const canTransfer = t.status === 'valid' && t.allow_transfers && t.fest_status !== 'cancelled' && t.fest_status !== 'ended' && t.ends_on >= todayIST();

  // Smart QR: sealed fresh from the database on every open (new add-ons show up), drawn live on the phone.
  // If the signing key is missing or broken, show the backup code instead of crashing the page.
  let svg = '';
  let qr: { url: string; liveSecret: string } | null = null;
  try {
    const data = await ticketSealData(sql, t.id);
    if (data) {
      qr = sealTicket(siteUrlOrNull() ?? 'https://thefest.in', data);
      svg = await QRCode.toString(qr.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#080808', light: '#F5F0E8' } });
    }
  } catch (e) {
    qr = null;
    await reportError(e, 'ticket QR');
  }
  const used = t.status === 'used';

  // Lunch / stay on this ticket: its own type + paid add-ons, and which ones were already used at the counters.
  const [perkRows, usedRows, addonTypes, owned] = await Promise.all([
    sql<{ lunch_days: string[]; includes_stay: boolean }[]>`
      select tt.lunch_days, tt.includes_stay from tickets tk join ticket_types tt on tt.id = tk.ticket_type_id where tk.id = ${t.id}
      union all
      select tt.lunch_days, tt.includes_stay from orders o join ticket_types tt on tt.id = o.ticket_type_id
      where o.addon_for = ${t.id} and o.status = 'paid'`,
    sql<{ slot: string; created_at: Date }[]>`select slot, created_at from perk_redemptions where ticket_id = ${t.id}`,
    t.fest_status === 'live' && t.ends_on >= todayIST() ? getTicketTypes(t.fest_id, 'addon') : Promise.resolve([]),
    // Pending checkouts only count while their hold lasts (15 min card, 30 min bank UPI, or a UTR was entered)
    sql<{ ticket_type_id: string }[]>`select ticket_type_id from orders where addon_for = ${t.id} and (status = 'paid' or (status = 'pending' and
      (utr is not null or created_at > now() - case when method = 'upi_direct' then interval '30 minutes' else interval '15 minutes' end)))`,
  ]);
  const lunchDays = [...new Set(perkRows.flatMap((r) => r.lunch_days))].sort();
  const hasStay = perkRows.some((r) => r.includes_stay);
  const usedAt = new Map(usedRows.map((r) => [r.slot, r.created_at]));
  const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const ownedTypes = new Set(owned.map((o) => o.ticket_type_id));
  const addons = addonTypes.filter((a) => a.active && !ownedTypes.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, description: a.description || [a.lunch_days.length ? `Lunch: ${a.lunch_days.map(dayName).join(', ')}` : '', a.includes_stay ? 'Stay' : ''].filter(Boolean).join(' · '), price: a.price_paise, left: a.quota - a.sold }));

  return (
    <div className="wrap stack g16" style={{ maxWidth: 440 }}>
      <Link href="/tickets" className="label">← My tickets</Link>
      {!used && <AutoRefresh seconds={15} stopAfterMinutes={10} />}

      <div className={`ticket ${used ? 'used' : ''}`}>
        <div className="ticket-top">
          <div className="label" style={{ color: 'var(--orange)' }}>{t.college}</div>
          <div className="display mt8" style={{ fontSize: 40 }}>{t.fest_name}</div>
          <div className="stack g4 mt12 small soft">
            <span>📅 {dateRange(t.starts_on, t.ends_on)}</span>
            <span>📍 {t.venue ? `${t.venue}, ` : ''}{t.city}</span>
          </div>
          <div className="row between mt16">
            <div><div className="label">Ticket</div><div>{t.type_name}</div></div>
            <div style={{ textAlign: 'right' }}><div className="label">Holder</div><div>{t.holder_name}</div></div>
          </div>
        </div>
        <div className="ticket-perf" />
        <div className="ticket-qr">
          {qr && svg
            ? <LiveQR ticketId={t.id} url={qr.url} secret={qr.liveSecret} initialSvg={svg} save={{ fest: t.fest_name, type: t.type_name, date: dateRange(t.starts_on, t.ends_on) }} />
            : <div className="alert info" role="status">The QR code can’t be shown right now. Your ticket is safe — show the code below at the gate, or try again in a few minutes.</div>}
          <div className="ticket-code">{t.code}</div>
          <div className="xs" style={{ color: 'rgba(8,8,8,.55)', textAlign: 'center' }}>
            {used ? `Checked in at ${time(t.checked_in_at!)}${t.gate ? ` · ${t.gate}` : ''}` : 'Turn your brightness up at the gate'}
          </div>
        </div>
        {used && <div className="stamp">ADMITTED</div>}
      </div>

      <p className="xs muted" style={{ textAlign: 'center' }}>
        This QR is digitally signed and works once. Show it live from this screen — screenshots still work but get flagged at the gate. Don&apos;t share it; whoever scans first gets in.
      </p>
      {(lunchDays.length > 0 || hasStay) && (
        <div className="card stack g8" aria-label="Lunch and stay">
          <div className="h3">Lunch &amp; stay</div>
          <p className="xs muted">Show this same QR at the lunch counter or the stay desk.</p>
          {lunchDays.map((d) => {
            const at = usedAt.get(`lunch:${d}`);
            return <div key={d} className="row between small"><span>Lunch · {dayName(d)}</span>{at ? <span className="badge gray">Used {time(at)}</span> : <span className="badge green">Unused</span>}</div>;
          })}
          {hasStay && (['stay_in', 'stay_out'] as const).map((k) => {
            const at = usedAt.get(k);
            return <div key={k} className="row between small"><span>Stay · {k === 'stay_in' ? 'check-in' : 'check-out'}</span>{at ? <span className="badge gray">Done {time(at)}</span> : <span className="badge green">Not yet</span>}</div>;
          })}
        </div>
      )}
      {addons.length > 0 && (
        <div className="card stack g8" id="addons">
          <div className="h3">Add lunch or stay</div>
          <p className="xs muted">Added to this ticket — same QR, no new ticket.</p>
          <BuyTickets
            festSlug={t.slug}
            signedIn
            isStudent
            types={addons}
            feeCfg={feeConfig()}
            gateway={activeGateway()}
            upiEnabled={t.upi_ok}
            hasPhone={!!user.phone && /^[6-9]\d{9}$/.test(user.phone.replace(/\D/g, '').slice(-10))}
            prefill={{ name: user.name, email: user.email, contact: user.phone ?? '' }}
            addonFor={t.id}
          />
        </div>
      )}
      <Link href={`/fests/${t.slug}`} className="btn outline block">Fest schedule & updates</Link>
      {canTransfer && (
        <details className="card">
          <summary className="small" style={{ cursor: 'pointer' }}>Can’t go? Transfer this ticket to a friend</summary>
          <ActionForm action={transferAction} className="form mt12">
            <input type="hidden" name="ticketId" value={t.id} />
            <label className="field"><span>Friend’s email (their THE FEST account)</span>
              <input className="input" type="email" name="email" autoComplete="off" placeholder="friend@college.edu" /></label>
            <label className="check"><input type="checkbox" name="confirm" /> I understand my QR stops working and they get a new one</label>
            <Submit className="btn sm">Transfer ticket</Submit>
          </ActionForm>
        </details>
      )}
    </div>
  );
}

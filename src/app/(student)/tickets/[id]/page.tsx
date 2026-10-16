import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { dateRange, time } from '@/lib/format';
import { signTicket } from '@/lib/ticket-crypto';
import { isUuid } from '@/lib/http';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ActionForm, Submit } from '@/components/forms';
import { todayIST } from '@/lib/format';
import { transferAction } from '../actions';

export const metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('student');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [t] = await sql<{
    id: string; code: string; holder_name: string; status: string; checked_in_at: Date | null; gate: string | null; fest_id: string;
    type_name: string; fest_name: string; slug: string; college: string; venue: string | null; city: string; starts_on: string; ends_on: string;
    void_reason: string | null; fest_status: string; allow_transfers: boolean;
  }[]>`
    select t.id, t.code, t.holder_name, t.status, t.checked_in_at, t.gate, t.fest_id,
           tt.name as type_name, f.name as fest_name, f.slug, f.college, f.venue, f.city, f.starts_on, f.ends_on,
           t.void_reason, f.status as fest_status, f.allow_transfers
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

  const payload = signTicket(t.id, t.fest_id);
  const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#080808', light: '#F5F0E8' } });
  const used = t.status === 'used';

  return (
    <div className="wrap stack g16" style={{ maxWidth: 440 }}>
      <Link href="/tickets" className="label">← My tickets</Link>
      {!used && <AutoRefresh seconds={8} />}

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
          <div dangerouslySetInnerHTML={{ __html: svg }} aria-label="Ticket QR code" role="img" />
          <div className="ticket-code">{t.code}</div>
          <div className="xs" style={{ color: 'rgba(8,8,8,.55)', textAlign: 'center' }}>
            {used ? `Checked in at ${time(t.checked_in_at!)}${t.gate ? ` · ${t.gate}` : ''}` : 'Turn your brightness up at the gate'}
          </div>
        </div>
        {used && <div className="stamp">ADMITTED</div>}
      </div>

      <p className="xs muted" style={{ textAlign: 'center' }}>
        This QR is digitally signed and works once. Screenshots work too — but don&apos;t share it; whoever scans first gets in.
      </p>
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

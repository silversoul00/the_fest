import Link from 'next/link';
import { ActionForm, Submit } from '@/components/forms';
import { dateRange, rupees, shortDate } from '@/lib/format';
import { BRAND_CATEGORIES, LIMITS, type RequestView } from '@/lib/sponsor-requests';
import type { ActionState } from '@/lib/types';

const CHIP: Record<string, [string, string]> = {
  sent: ['Waiting for an answer', 'yellow'], accepted: ['Accepted', 'green'], declined: ['Declined', 'red'],
  withdrawn: ['Withdrawn', 'gray'], expired: ['Expired', 'gray'],
};

/**
 * One sponsorship request, as the brand ('brand') or the fest ('org') sees it. Received + open → Accept / Decline;
 * sent + open → Withdraw. The other side's contact shows only once accepted (the query leaves it null before).
 */
export function RequestCard({ r, side, action, festId, locked }: {
  r: RequestView; side: 'brand' | 'org'; action: (s: ActionState, fd: FormData) => Promise<ActionState>; festId?: string;
  /** No buttons (e.g. email not confirmed yet). The server refuses these actions anyway. */
  locked?: boolean;
}) {
  const received = (r.direction === 'brand_to_org') === (side === 'org');
  const open = r.status === 'sent' && !r.expired && !locked;
  const [label, color] = CHIP[r.status === 'sent' && r.expired ? 'expired' : r.status];
  const hidden = (what: string) => (
    <>
      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="do" value={what} />
      {festId && <input type="hidden" name="festId" value={festId} />}
    </>
  );
  return (
    <div className="card stack g8 req-card" data-request={r.id} style={{ overflowWrap: 'anywhere' }}>
      <div className="row between g8 wrap-row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          {side === 'brand'
            ? <><div className="h3">{r.fest_name}</div><div className="xs muted">{r.college} · {r.city} · {dateRange(r.starts_on, r.ends_on)}</div></>
            : <><div className="h3">{r.brand}</div><div className="xs muted">{BRAND_CATEGORIES[r.category ?? ''] ?? 'Brand'}</div></>}
        </div>
        <span className={`badge ${color}`}>{label}</span>
      </div>
      <div className="row g8 wrap-row"><span className="badge blue">{r.tier}</span><span className="mono">{rupees(r.amount_paise)}</span>
        <span className="xs muted">{received ? 'Received' : 'Sent'} {shortDate(r.created_at)}</span></div>
      {r.deliverables && <div className="small"><span className="label">What&apos;s offered / wanted</span><br />{r.deliverables}</div>}
      {r.message && <div className="small soft" style={{ whiteSpace: 'pre-line' }}>{r.message}</div>}
      {r.reply && <div className="small"><span className="label">Note with the decline</span><br />{r.reply}</div>}
      {r.status === 'accepted' && (
        <div className="alert ok">
          {side === 'brand' ? 'Organizer contact' : 'Sponsor contact'}: <span className="req-contact">{r.contact}</span>
          {side === 'brand' && r.sponsor_id && <> · <Link href={`/sponsor/${r.sponsor_id}`}>Open sponsor dashboard</Link></>}
        </div>
      )}
      {open && received && (
        <div className="stack g8">
          <ActionForm action={action} className="stack g8">
            {hidden('accept')}
            <Submit className="btn green block">Accept</Submit>
            <span className="xs muted">Accepting adds the sponsor and shares contacts. Payment is settled directly between you; THE FEST doesn&apos;t take a cut yet.</span>
          </ActionForm>
          <details>
            <summary className="btn outline block">Decline…</summary>
            <ActionForm action={action} className="stack g8 mt8">
              {hidden('decline')}
              <label className="field"><span>Note (optional)</span>
                <input className="input" name="reply" maxLength={LIMITS.reply} placeholder="e.g. Budget is used up this term" /></label>
              <Submit className="btn danger block">Decline request</Submit>
            </ActionForm>
          </details>
        </div>
      )}
      {open && !received && (
        <ActionForm action={action}>{hidden('withdraw')}<Submit className="btn outline block">Withdraw</Submit></ActionForm>
      )}
    </div>
  );
}

/** Tier / amount / deliverables / message fields shared by both "send" forms. */
export function RequestFields({ deliverablesHint }: { deliverablesHint: string }) {
  return (
    <>
      <div className="form-row">
        <label className="field"><span>Tier</span>
          <select className="select" name="tier" defaultValue="Associate">
            <option>Title</option><option>Powered by</option><option>Associate</option><option>Partner</option>
          </select>
        </label>
        <label className="field"><span>Amount (₹)</span><input className="input" name="amount" inputMode="decimal" required placeholder="50000" /></label>
      </div>
      <label className="field"><span>{deliverablesHint}</span>
        <textarea className="textarea" name="deliverables" maxLength={LIMITS.deliverables} placeholder="Stall, stage mentions, logo on passes…" /></label>
      <label className="field"><span>Message</span>
        <textarea className="textarea" name="message" maxLength={LIMITS.message} placeholder="A short note. Don’t share phone numbers here — contacts are shared when a request is accepted." /></label>
    </>
  );
}

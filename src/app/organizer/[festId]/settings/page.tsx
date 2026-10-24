import { pageAccess } from '@/lib/fest-access';
import Link from 'next/link';
import { FestForm } from '../../FestForm';
import { festFormFields, isRenameNote, renameReviewFor } from '@/lib/fest-form';
import { setAllowTransfers, cancelFestAction, setFestStatus, updateFest } from '../../actions';
import { ActionForm, Submit } from '@/components/forms';
import { siteUrlOrNull } from '@/lib/env';
import { sql } from '@/lib/db';

export default async function Settings({ params }: { params: Promise<{ festId: string }> }) {
  const { fest, access } = await pageAccess((await params).festId, 'fest');
  const site = siteUrlOrNull() ?? '';
  const [{ holders }] = await sql<{ holders: number }[]>`
    select count(distinct user_id)::int as holders from tickets where fest_id = ${fest.id} and status <> 'void'`;

  const StatusBtn = ({ to, label, cls }: { to: string; label: string; cls: string }) => (
    <form action={setFestStatus}>
      <input type="hidden" name="festId" value={fest.id} />
      <input type="hidden" name="status" value={to} />
      <button className={`btn sm ${cls}`}>{label}</button>
    </form>
  );

  return (
    <div className="stack g16" style={{ maxWidth: 680 }}>
      <h1 className="h2">Settings</h1>

      <div className="card stack g12">
        <div className="row between wrap-row g8">
          <div>
            <div className="label">Status</div>
            <div className="h3 mt8">{{ live: 'Live — tickets on sale', draft: 'Draft — only you can see it', review: 'Waiting for THE FEST approval', ended: 'Ended', cancelled: 'Cancelled' }[fest.status]}</div>
          </div>
          <div className="row g8 wrap-row">
            {(fest.status === 'draft' || fest.status === 'ended') && <StatusBtn to="live" label={fest.status === 'ended' ? 'Reopen' : fest.approved_at ? 'Publish' : 'Submit for approval'} cls="green" />}
            {(fest.status === 'live' || fest.status === 'review') && <StatusBtn to="draft" label={fest.status === 'review' ? 'Withdraw' : 'Unpublish'} cls="outline" />}
            {(fest.status === 'live' || fest.status === 'draft') && <StatusBtn to="ended" label="End fest" cls="danger" />}
          </div>
        </div>
        {isRenameNote(fest.review_note) && (fest.status === 'draft' || fest.status === 'ended') && (
          <p className="xs c-orange wrap-anywhere" data-testid="rename-note">{fest.review_note} {fest.status === 'ended' ? 'Reopen' : 'Publish'} sends the fest to THE FEST for a quick check first.</p>
        )}
        <div className="divider" style={{ margin: 0 }} />
        <div className="row between wrap-row g8">
          <div>
            <div className="label">Ticket transfers</div>
            <div className="small soft mt8">{fest.allow_transfers ? 'On — students can pass a ticket to a friend; the old QR stops working.' : 'Off — tickets stay with the buyer.'}</div>
          </div>
          <form action={setAllowTransfers}>
            <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="allow" value={fest.allow_transfers ? '0' : '1'} />
            <button className="btn sm outline">{fest.allow_transfers ? 'Turn off' : 'Turn on'}</button>
          </form>
        </div>
        <div className="divider" style={{ margin: 0 }} />
        <div>
          <div className="label">Public link</div>
          <div className="mono small mt8 accent" style={{ wordBreak: 'break-all' }}>{site.replace(/^https?:\/\//, '')}/fests/{fest.slug}</div>
        </div>
      </div>

      <div className="card">
        <div className="h3 mb16">Fest details</div>
        <FestForm action={updateFest} fest={festFormFields(fest)} holders={holders} rename={renameReviewFor(fest, holders)} />
      </div>
      <div className="card row between wrap-row g8" id="team">
        <div className="grow" style={{ minWidth: 200 }}>
          <div className="h3">Team &amp; co-organizers</div>
          <p className="small soft mt8">Co-organizers, finance, sponsorship and media leads, event heads and volunteers are managed on the Team tab.</p>
        </div>
        <Link href={`/organizer/${fest.id}/team`} className="btn sm outline">Open Team →</Link>
      </div>

      {access.perms.has('cancel') && fest.status !== 'cancelled' && fest.status !== 'ended' && (
        <div className="card stack g12" style={{ borderColor: 'rgba(255,45,85,.35)' }}>
          <div className="h3 c-red">Cancel this fest</div>
          <p className="small soft">Stops ticket sales and refunds every unused ticket in full. Card payments are refunded automatically; zero-fee UPI payments appear in Sales for you to send back. This can’t be undone.</p>
          <ActionForm action={cancelFestAction}>
            <input type="hidden" name="festId" value={fest.id} />
            <label className="field"><span>Reason (sent to every ticket holder)</span><input className="input" name="reason" placeholder="Postponed due to heavy rain" /></label>
            <label className="field"><span>Type CANCEL to confirm</span><input className="input mono" name="confirm" autoComplete="off" /></label>
            <Submit className="btn danger">Cancel fest &amp; refund everyone</Submit>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

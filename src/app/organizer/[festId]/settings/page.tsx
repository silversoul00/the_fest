import { requireUser } from '@/lib/auth';
import { getMembers, getOwnFest } from '@/lib/queries';
import { FestForm } from '../../FestForm';
import { festFormFields } from '@/lib/fest-form';
import { addMember, setAllowTransfers, cancelFestAction, removeMember, setFestStatus, updateFest } from '../../actions';
import { ActionForm, Submit } from '@/components/forms';

export default async function Settings({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const members = await getMembers(fest.id);

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
        <FestForm action={updateFest} fest={festFormFields(fest)} />
      </div>
      <div className="card stack g12" id="team">
        <div className="h3">Co-organizers</div>
        <p className="small soft">People who can run this fest with you: tickets, schedule, announcements, sponsors, volunteers, sales and UPI matching. Only you can change where money goes, refund, cancel the fest or change this list.</p>
        {members.length === 0 ? <p className="small muted">Just you so far.</p> : (
          <div className="stack g8">
            {members.map((m) => (
              <div key={m.id} className="row between g8 small member">
                <span className="grow">{m.name ?? <span className="muted">Not signed up yet</span>} · <span className="mono">{m.email}</span></span>
                {(fest.is_owner || m.email === user.email.toLowerCase()) && (
                  <form action={removeMember}>
                    <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={m.id} />
                    <button className="btn sm outline">{fest.is_owner ? 'Remove' : 'Leave fest'}</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {fest.is_owner && (
          <ActionForm action={addMember}>
            <input type="hidden" name="festId" value={fest.id} />
            <label className="field"><span>Add by email</span><input className="input" type="email" name="email" placeholder="cofounder@college.edu" /></label>
            <Submit className="btn sm">Add co-organizer</Submit>
          </ActionForm>
        )}
      </div>

      {fest.is_owner && fest.status !== 'cancelled' && fest.status !== 'ended' && (
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

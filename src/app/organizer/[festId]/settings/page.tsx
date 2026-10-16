import { requireUser } from '@/lib/auth';
import { getOwnFest } from '@/lib/queries';
import { FestForm } from '../../FestForm';
import { setFestStatus, updateFest } from '../../actions';

export default async function Settings({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';

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
        <div>
          <div className="label">Public link</div>
          <div className="mono small mt8 accent" style={{ wordBreak: 'break-all' }}>{site.replace(/^https?:\/\//, '')}/fests/{fest.slug}</div>
        </div>
      </div>

      <div className="card">
        <div className="h3 mb16">Fest details</div>
        <FestForm action={updateFest} fest={fest} />
      </div>
    </div>
  );
}

import { pageAccess } from '@/lib/fest-access';
import { getAnnouncements } from '@/lib/queries';
import { ago } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty } from '@/components/ui';
import { deleteAnnouncement, postAnnouncement } from '../../actions';

export default async function Announcements({ params }: { params: Promise<{ festId: string }> }) {
  const { fest } = await pageAccess((await params).festId, 'announce');
  const items = await getAnnouncements(fest.id, 50);

  return (
    <div className="stack g16">
      <h1 className="h2">Announcements</h1>
      <div className="card">
        <p className="xs muted mb16">Posts appear instantly on your public fest page and on every attendee&apos;s ticket screen.</p>
        <ActionForm action={postAnnouncement} resetOnSuccess>
          <input type="hidden" name="festId" value={fest.id} />
          <label className="field"><span>Headline</span><input className="input" name="title" required maxLength={120} placeholder="Pro Night gates open at 6:15 PM" /></label>
          <label className="field"><span>Details (optional)</span><textarea className="textarea" name="body" maxLength={1000} /></label>
          <label className="check"><input type="checkbox" name="urgent" /> Mark as urgent (shown in orange)</label>
          <Submit className="btn">📢 Post announcement</Submit>
        </ActionForm>
      </div>

      {items.length === 0 ? <Empty icon="📢" title="Nothing posted yet" /> : (
        <div className="list">
          {items.map((a) => (
            <div key={a.id} className="li" style={{ alignItems: 'flex-start' }}>
              <span>{a.urgent ? '🚨' : '📢'}</span>
              <div className="grow">
                <div className="row between g8"><strong className={a.urgent ? 'c-orange' : ''}>{a.title}</strong><span className="xs muted" style={{ whiteSpace: 'nowrap' }}>{ago(a.created_at)}</span></div>
                {a.body && <div className="small soft mt8">{a.body}</div>}
              </div>
              <form action={deleteAnnouncement}>
                <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={a.id} />
                <button className="btn text xs" style={{ color: 'var(--red)' }} aria-label="Delete">✕</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

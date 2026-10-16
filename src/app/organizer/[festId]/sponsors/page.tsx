import { requireUser } from '@/lib/auth';
import { getOwnFest, getSponsors } from '@/lib/queries';
import { num, rupees } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty, Stat } from '@/components/ui';
import { addSponsor, removeSponsor } from '../../actions';

export default async function Sponsors({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const sponsors = await getSponsors(fest.id);
  const total = sponsors.reduce((a, s) => a + s.amount_paise, 0);
  const visits = sponsors.reduce((a, s) => a + s.visits, 0);

  return (
    <div className="stack g16">
      <h1 className="h2">Sponsors</h1>
      <div className="grid-2 grid-3">
        <Stat label="Sponsors" value={sponsors.length} color="var(--blue)" />
        <Stat label="Sponsorship" value={rupees(total, { compact: true })} color="var(--green)" />
        <Stat label="Booth visits" value={num(visits)} sub="students who scanned a booth QR" />
      </div>

      {sponsors.length === 0 ? <Empty icon="🏷️" title="No sponsors yet">Add a sponsor below — they get a live dashboard and a booth QR.</Empty> : (
        <div className="list">
          {sponsors.map((s) => (
            <div key={s.id} className="li wrap-row">
              <div className="avatar" style={{ color: 'var(--blue)' }}>{s.brand.slice(0, 2).toUpperCase()}</div>
              <div className="grow" style={{ minWidth: 160 }}>
                <div>{s.brand} <span className="badge blue" style={{ marginLeft: 4 }}>{s.tier}</span></div>
                <div className="xs muted truncate">{s.email} · {rupees(s.amount_paise)} · {num(s.visits)} booth visits</div>
              </div>
              <a className="btn sm outline" href={`/booth/${s.booth_code}/print`} target="_blank" rel="noopener">Booth QR</a>
              <form action={removeSponsor}>
                <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={s.id} />
                <button className="btn text xs" style={{ color: 'var(--red)' }} aria-label={`Remove ${s.brand}`}>✕</button>
              </form>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="h3 mb8">Add a sponsor</div>
        <p className="xs muted mb16">The sponsor signs up with this email (role: Sponsor) and sees footfall and booth visits live.</p>
        <ActionForm action={addSponsor} resetOnSuccess>
          <input type="hidden" name="festId" value={fest.id} />
          <div className="form-row">
            <label className="field"><span>Brand</span><input className="input" name="brand" required placeholder="Brand name" /></label>
            <label className="field"><span>Sponsor contact email</span><input className="input" type="email" name="email" required placeholder="marketing@brand.com" /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>Tier</span>
              <select className="select" name="tier" defaultValue="Associate">
                <option>Title</option><option>Powered by</option><option>Associate</option><option>Partner</option><option>In-kind</option>
              </select>
            </label>
            <label className="field"><span>Deal amount (₹)</span><input className="input" type="number" min={0} name="amount" placeholder="100000" /></label>
          </div>
          <Submit className="btn blue">+ Add sponsor</Submit>
        </ActionForm>
      </div>
    </div>
  );
}

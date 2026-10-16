import { requireUser } from '@/lib/auth';
import { getOwnFest, getTicketTypes } from '@/lib/queries';
import { num, rupees } from '@/lib/format';
import { feeConfig } from '@/lib/payments';
import { describeFee } from '@/lib/pricing';
import { ActionForm, Submit } from '@/components/forms';
import { addTicketType, toggleTicketType, updateTicketType } from '../../actions';

export default async function TicketTypes({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const types = await getTicketTypes(fest.id);
  const cfg = feeConfig();

  return (
    <div className="stack g16">
      <h1 className="h2">Ticket types</h1>
      <p className="small soft">
        {cfg.payer === 'student'
          ? <>THE FEST charges students a convenience fee of {describeFee(cfg)}{cfg.passGateway ? ' plus card payment charges' : ''}. You receive the full ticket price.</>
          : <>THE FEST keeps {describeFee(cfg)}; the rest is paid out to you.</>} Free tickets cost nothing.
      </p>

      <div className="stack g12">
        {types.map((t) => {
          const pct = Math.round((t.sold / t.quota) * 100);
          return (
            <div key={t.id} className="card" style={{ opacity: t.active ? 1 : 0.6 }}>
              <div className="row between g12 wrap-row">
                <div className="grow">
                  <div className="row g8"><strong style={{ fontSize: 17 }}>{t.name}</strong>{!t.active && <span className="badge gray">Hidden</span>}</div>
                  {t.description && <div className="xs muted">{t.description}</div>}
                </div>
                <span className="display c-yellow" style={{ fontSize: 26 }}>{t.price_paise ? rupees(t.price_paise) : 'FREE'}</span>
              </div>
              <div className="bar mt12"><i style={{ width: `${pct}%` }} /></div>
              <div className="row between xs muted mt8"><span>{num(t.sold)} sold of {num(t.quota)}</span><span>{rupees(t.sold * t.price_paise, { compact: true })} gross</span></div>
              <details className="mt12">
                <summary className="label" style={{ cursor: 'pointer' }}>Edit</summary>
                <ActionForm action={updateTicketType} className="form mt12">
                  <input type="hidden" name="festId" value={fest.id} />
                  <input type="hidden" name="id" value={t.id} />
                  <div className="form-row">
                    <label className="field"><span>Name</span><input className="input" name="name" defaultValue={t.name} required /></label>
                    <label className="field"><span>Description</span><input className="input" name="description" defaultValue={t.description} /></label>
                  </div>
                  <div className="form-row">
                    <label className="field"><span>Price (₹)</span><input className="input" name="price" type="number" min={0} step="1" defaultValue={t.price_paise / 100} required /></label>
                    <label className="field"><span>Quantity</span><input className="input" name="quota" type="number" min={Math.max(1, t.sold)} defaultValue={t.quota} required /></label>
                  </div>
                  <Submit className="btn sm">Save</Submit>
                </ActionForm>
                <form action={toggleTicketType} className="mt8">
                  <input type="hidden" name="festId" value={fest.id} />
                  <input type="hidden" name="id" value={t.id} />
                  <button className="btn sm outline">{t.active ? 'Hide from sale' : 'Put back on sale'}</button>
                </form>
              </details>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="h3 mb16">Add a ticket type</div>
        <ActionForm action={addTicketType} resetOnSuccess>
          <input type="hidden" name="festId" value={fest.id} />
          <div className="form-row">
            <label className="field"><span>Name</span><input className="input" name="name" required placeholder="VIP / Early bird / Workshop" /></label>
            <label className="field"><span>Description</span><input className="input" name="description" placeholder="What's included" /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>Price (₹) — 0 for free</span><input className="input" name="price" type="number" min={0} step="1" required placeholder="499" /></label>
            <label className="field"><span>Quantity</span><input className="input" name="quota" type="number" min={1} required placeholder="200" /></label>
          </div>
          <Submit className="btn">+ Add ticket type</Submit>
        </ActionForm>
      </div>
    </div>
  );
}

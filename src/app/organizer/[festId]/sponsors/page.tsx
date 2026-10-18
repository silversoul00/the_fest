import { requireUser } from '@/lib/auth';
import { getOwnFest, getSponsors } from '@/lib/queries';
import { num, rupees } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty, Stat } from '@/components/ui';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { leadsReady } from '@/lib/sponsor-leads';
import { addSponsor, orgDecide, removeSponsor, sendBrandRequest, setOpenToSponsors } from '../../actions';
import { RequestCard, RequestFields } from '@/components/RequestCard';
import { BRAND_CATEGORIES, REQUESTS_MISSING, festRequests, requestsReady } from '@/lib/sponsor-requests';

export default async function Sponsors({ params, searchParams }: { params: Promise<{ festId: string }>; searchParams: Promise<{ remove?: string; err?: string; removed?: string; to?: string; bcat?: string; bcity?: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const sp = await searchParams;
  const sponsors = await getSponsors(fest.id);
  const total = sponsors.reduce((a, s) => a + s.amount_paise, 0);
  const visits = sponsors.reduce((a, s) => a + s.visits, 0);
  // Verified booth visit = the visitor holds a gate-scanned ticket (same count as the sponsor dashboard and report).
  const verifiedRows = await sql<{ sponsor_id: string; n: number }[]>`
    select v.sponsor_id, count(*)::int n from sponsor_visits v join sponsors s on s.id = v.sponsor_id
    where s.fest_id = ${fest.id} and exists
      (select 1 from tickets t where t.fest_id = ${fest.id} and t.user_id = v.user_id and t.status = 'used')
    group by 1`;
  const verifiedBy = new Map(verifiedRows.map((r) => [r.sponsor_id, r.n]));
  // Organizers see how many students shared (a count) — never the contacts. "any" includes withdrawn rows.
  const leadRows = (await leadsReady())
    ? await sql<{ sponsor_id: string; n: number; any: number }[]>`
        select l.sponsor_id, (count(*) filter (where l.withdrawn_at is null))::int n, count(*)::int as any
        from sponsor_leads l join sponsors s on s.id = l.sponsor_id
        where s.fest_id = ${fest.id} group by 1`
    : [];
  const leadsBy = new Map(leadRows.map((r) => [r.sponsor_id, r]));
  const removing = sponsors.find((s) => s.id === sp.remove);
  const base = `/organizer/${fest.id}/sponsors`;

  // Sponsorship requests (v2.6): brands see only listed profile fields — never emails — until a request is accepted.
  const ready = await requestsReady();
  const bcat = sp.bcat && sp.bcat in BRAND_CATEGORIES ? sp.bcat : '';
  const bcity = (sp.bcity ?? '').trim().slice(0, 40);
  type BrandRow = { user_id: string; brand: string; category: string; budget_min_paise: number; budget_max_paise: number; cities: string[]; about: string | null };
  const [requests, brands, [open]] = ready ? await Promise.all([
    festRequests(fest.id),
    sql<BrandRow[]>`
      select p.user_id, p.brand, p.category, p.budget_min_paise, p.budget_max_paise, p.cities, p.about
      from brand_profiles p join users u on u.id = p.user_id
      where p.listed and u.role = 'sponsor' ${bcat ? sql`and p.category = ${bcat}` : sql``}
        ${bcity ? sql`and exists (select 1 from unnest(p.cities) c where c ilike ${bcity})` : sql``}
      order by p.updated_at desc limit 100`,
    sql<{ open: boolean }[]>`select open_to_sponsors as open from fests where id = ${fest.id}`,
  ]) : [[], [], [{ open: false }]];
  const received = requests.filter((r) => r.direction === 'brand_to_org');
  const sentReqs = requests.filter((r) => r.direction === 'org_to_brand');
  const target = brands.find((b) => b.user_id === sp.to);
  const budget = (b: BrandRow) => b.budget_max_paise ? `${rupees(b.budget_min_paise, { compact: true })}–${rupees(b.budget_max_paise, { compact: true })}` : b.budget_min_paise ? `from ${rupees(b.budget_min_paise, { compact: true })}` : 'Budget not given';

  return (
    <div className="stack g16">
      <h1 className="h2">Sponsors</h1>
      <div className="grid-2 grid-3">
        <Stat label="Sponsors" value={sponsors.length} color="var(--blue)" />
        <Stat label="Sponsorship" value={rupees(total, { compact: true })} color="var(--green)" />
        <Stat label="Booth visits (total)" value={num(visits)} sub="all booth QR check-ins, verified or not" />
      </div>

      {sp.err === 'leads' && <div className="alert error" role="alert">This sponsor has student leads, so it can&apos;t be removed. Students must keep their &ldquo;Stop sharing&rdquo; option.</div>}
      {sp.removed && <div className="alert ok" role="status">Sponsor removed.</div>}

      {removing && (
        <section className="card stack g12" aria-label="Remove sponsor">
          {(leadsBy.get(removing.id)?.any ?? 0) > 0 ? (
            <>
              <div className="h3">{removing.brand} can&apos;t be removed</div>
              <p className="small muted">Students shared their contact with {removing.brand}. They must keep their &ldquo;Stop sharing&rdquo; option, and {removing.brand} must keep seeing who stopped, so this sponsor stays.</p>
              <Link className="btn outline block" href={base}>OK</Link>
            </>
          ) : (
            <>
              <div className="h3">Remove {removing.brand}?</div>
              <p className="small muted">Their dashboard, booth QR and {num(removing.visits)} booth visits will be deleted. This can&apos;t be undone.</p>
              <div className="row g8 wrap-row">
                <form action={removeSponsor} className="grow">
                  <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={removing.id} />
                  <button className="btn danger block" type="submit">Yes, remove {removing.brand}</button>
                </form>
                <Link className="btn outline grow" href={base}>Cancel</Link>
              </div>
            </>
          )}
        </section>
      )}

      {sponsors.length === 0 ? <Empty icon="🏷️" title="No sponsors yet">Add a sponsor below — they get a live dashboard and a booth QR.</Empty> : (
        <div className="list">
          {sponsors.map((s) => (
            <div key={s.id} className="li stack g12" style={{ alignItems: 'stretch' }} data-sponsor={s.id}>
              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="avatar" style={{ color: 'var(--blue)' }}>{s.brand.slice(0, 2).toUpperCase()}</div>
                <div className="grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <div>{s.brand} <span className="badge blue" style={{ marginLeft: 4 }}>{s.tier}</span></div>
                  <div className="xs muted">{s.email} · {rupees(s.amount_paise)}</div>
                  <div className="xs muted sponsor-counts">{num(verifiedBy.get(s.id) ?? 0)} verified · {num(s.visits)} total booth visits · {num(leadsBy.get(s.id)?.n ?? 0)} leads</div>
                </div>
              </div>
              <div className="row g8 wrap-row">
                <Link className="btn outline grow" href={`${base}/${s.id}/report`}>Report</Link>
                <a className="btn outline grow" href={`/booth/${s.booth_code}/print`} target="_blank" rel="noopener">Booth QR</a>
                <Link className="btn danger" href={`${base}?remove=${s.id}`} aria-label={`Remove ${s.brand}`}>✕</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {!ready ? <div className="alert error">{REQUESTS_MISSING}</div> : (
        <>
          <section className="card stack g8" aria-label="Show this fest to brands">
            <ActionForm action={setOpenToSponsors} className="stack g8">
              <input type="hidden" name="festId" value={fest.id} />
              <label className="row g8" style={{ minHeight: 44 }}>
                <input type="checkbox" name="open" defaultChecked={open.open} /> <span>Show this fest to brands (media kit)</span>
              </label>
              <p className="xs muted">Brands then see the fest, dates, tickets sold and college mix in &ldquo;Find fests&rdquo;, and can ask to sponsor. No student names or emails, and not your email until you accept.</p>
              <Submit className="btn outline block">Save</Submit>
            </ActionForm>
            <Link className="btn outline block" href={`/sponsor/fests/${fest.id}`}>Preview the media kit</Link>
          </section>

          <section className="stack g12" aria-label="Requests">
            <div className="h3">Requests received ({received.length})</div>
            {received.length === 0 ? <p className="small muted">No brand has asked yet.</p>
              : received.map((r) => <RequestCard key={r.id} r={r} side="org" action={orgDecide} festId={fest.id} />)}
            <div className="h3 mt8">Requests sent ({sentReqs.length})</div>
            {sentReqs.length === 0 ? <p className="small muted">Pick a brand below and send a request.</p>
              : sentReqs.map((r) => <RequestCard key={r.id} r={r} side="org" action={orgDecide} festId={fest.id} />)}
          </section>

          <section className="stack g12" id="brands" aria-label="Find brands">
            <div className="h3">Find brands</div>
            <form className="form-row" method="get" action={`${base}#brands`}>
              <label className="field"><span>Category</span>
                <select className="select" name="bcat" defaultValue={bcat}><option value="">Any</option>
                  {Object.entries(BRAND_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field"><span>City</span><input className="input" name="bcity" defaultValue={bcity} placeholder="Bengaluru" /></label>
              <button className="btn outline" type="submit" style={{ alignSelf: 'flex-end' }}>Filter</button>
            </form>
            {target && (
              <div className="card" id="send" aria-label={`Send a request to ${target.brand}`}>
                <div className="h3 mb8">Send a request to {target.brand}</div>
                <ActionForm action={sendBrandRequest} resetOnSuccess>
                  <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="brandUserId" value={target.user_id} />
                  <RequestFields deliverablesHint="What you offer (stall, mentions…)" />
                  <p className="xs muted">{target.brand} sees your fest and college — not your email — until they accept.</p>
                  <Submit className="btn blue block">Send request</Submit>
                </ActionForm>
              </div>
            )}
            {brands.length === 0 ? <p className="small muted">No listed brands match.</p> : (
              <div className="grid-auto">
                {brands.map((b) => (
                  <div key={b.user_id} className="card stack g8 brand-card" data-brand={b.user_id} style={{ overflowWrap: 'anywhere' }}>
                    <div className="h3">{b.brand}</div>
                    <div className="row g8 wrap-row"><span className="badge gray">{BRAND_CATEGORIES[b.category] ?? b.category}</span><span className="badge green">{budget(b)}</span></div>
                    {b.cities.length > 0 && <div className="xs muted">{b.cities.join(' · ')}</div>}
                    {b.about && <div className="small soft">{b.about}</div>}
                    <Link className="btn outline block" href={`${base}?to=${b.user_id}#send`}>Send request</Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
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

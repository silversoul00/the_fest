import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ActionForm, Submit } from '@/components/forms';
import { SponsorShell } from '@/components/SponsorShell';
import { VerifyNotice } from '@/components/VerifyNotice';
import { BRAND_CATEGORIES, LIMITS, REQUESTS_MISSING, requestsReady } from '@/lib/sponsor-requests';
import { saveBrandProfile } from '../actions';

export const metadata = { title: 'Brand profile' };

const rs = (p: number) => (p ? String(p / 100) : '');

export default async function BrandProfile({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const user = await requireUser('sponsor');
  const sp = await searchParams;
  const ready = await requestsReady();
  const [p] = ready
    ? await sql<{ brand: string; category: string; budget_min_paise: number; budget_max_paise: number; cities: string[]; about: string | null; listed: boolean }[]>`
        select brand, category, budget_min_paise, budget_max_paise, cities, about, listed from brand_profiles where user_id = ${user.id}`
    : [];
  return (
    <SponsorShell user={user} cur="profile">
      <div>
        <span className="kicker" style={{ color: 'var(--blue)' }}>Brand profile</span>
        <h1 className="h2 mt8">Your <span className="c-blue">brand</span></h1>
      </div>
      {!user.verified && <VerifyNotice email={user.email} />}
      {sp.need && !p && <div className="alert error" role="alert">Set up your brand profile first, then send your request.</div>}
      {!ready ? <div className="alert error">{REQUESTS_MISSING}</div> : (
        <div className="card">
          <p className="xs muted mb16">Organizers see your brand, category, budget range and cities — never your email or phone, until you accept a request.</p>
          <ActionForm action={saveBrandProfile}>
            <label className="field"><span>Brand name</span><input className="input" name="brand" required maxLength={LIMITS.brand} defaultValue={p?.brand ?? ''} placeholder="Your brand" /></label>
            <label className="field"><span>Category</span>
              <select className="select" name="category" defaultValue={p?.category ?? 'other'}>
                {Object.entries(BRAND_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label className="field"><span>Budget from (₹)</span><input className="input" name="budget_min" inputMode="decimal" defaultValue={rs(p?.budget_min_paise ?? 0)} placeholder="25000" /></label>
              <label className="field"><span>Budget up to (₹)</span><input className="input" name="budget_max" inputMode="decimal" defaultValue={rs(p?.budget_max_paise ?? 0)} placeholder="200000" /></label>
            </div>
            <label className="field"><span>Cities (up to {LIMITS.cities}, commas)</span><input className="input" name="cities" defaultValue={p?.cities.join(', ') ?? ''} placeholder="Bengaluru, Mysuru" /></label>
            <label className="field"><span>About (optional)</span><textarea className="textarea" name="about" maxLength={LIMITS.about} defaultValue={p?.about ?? ''} placeholder="What you sell and who you want to reach" /></label>
            <label className="row g8" style={{ minHeight: 44 }}><input type="checkbox" name="listed" defaultChecked={p?.listed ?? false} /> <span className="small">List my brand for organizers (they can send you requests)</span></label>
            <Submit className="btn blue block">Save profile</Submit>
          </ActionForm>
        </div>
      )}
    </SponsorShell>
  );
}

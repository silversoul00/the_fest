import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { dateRange, num } from '@/lib/format';
import { SponsorShell } from '@/components/SponsorShell';
import { Empty, catLabel } from '@/components/ui';
import { REQUESTS_MISSING, requestsReady, visibleToBrands } from '@/lib/sponsor-requests';

export const metadata = { title: 'Find fests' };

type Row = { id: string; name: string; college: string; city: string; category: string; starts_on: string; ends_on: string; emoji: string; sold: number };

export default async function FindFests({ searchParams }: { searchParams: Promise<{ city?: string; category?: string; month?: string }> }) {
  const user = await requireUser('sponsor');
  const sp = await searchParams;
  const city = (sp.city ?? '').trim().slice(0, 40);
  const category = (sp.category ?? '').trim();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : '';
  const ready = await requestsReady();
  const rows = ready ? await sql<Row[]>`
    select f.id, f.name, f.college, f.city, f.category, f.starts_on, f.ends_on, f.emoji,
      (select count(*) from tickets t where t.fest_id = f.id and t.status <> 'void')::int as sold
    from fests f where ${visibleToBrands()}
      ${city ? sql`and f.city ilike ${city}` : sql``}
      ${category ? sql`and f.category::text = ${category}` : sql``}
      ${month ? sql`and to_char(f.starts_on, 'YYYY-MM') <= ${month} and to_char(f.ends_on, 'YYYY-MM') >= ${month}` : sql``}
    order by f.starts_on limit 100` : [];
  const cities = ready ? await sql<{ city: string }[]>`select distinct f.city from fests f where ${visibleToBrands()} order by 1` : [];
  return (
    <SponsorShell user={user} cur="fests">
      <div>
        <span className="kicker" style={{ color: 'var(--blue)' }}>Find fests</span>
        <h1 className="h2 mt8">Fests open to <span className="c-blue">sponsors</span></h1>
        <p className="small muted mt8">Numbers come from THE FEST ticketing, not from the organizer&apos;s pitch deck.</p>
      </div>
      {!ready ? <div className="alert error">{REQUESTS_MISSING}</div> : (
        <>
          <form className="form-row" method="get">
            <label className="field"><span>City</span>
              <select className="select" name="city" defaultValue={city}><option value="">Any city</option>{cities.map((c) => <option key={c.city}>{c.city}</option>)}</select></label>
            <label className="field"><span>Category</span>
              <select className="select" name="category" defaultValue={category}><option value="">Any</option>
                {['cultural', 'tech', 'sports', 'management', 'other'].map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</select></label>
            <label className="field"><span>Month</span><input className="input" type="month" name="month" defaultValue={month} /></label>
            <button className="btn outline" type="submit" style={{ alignSelf: 'flex-end' }}>Filter</button>
          </form>
          {rows.length === 0 ? <Empty icon="🔎" title="No fests match">Fests appear here when their organizers switch on &ldquo;Show this fest to brands&rdquo;.</Empty> : (
            <div className="grid-auto">
              {rows.map((f) => (
                <Link key={f.id} href={`/sponsor/fests/${f.id}`} className="card link stack g8" data-fest={f.id}>
                  <span style={{ fontSize: 28 }}>{f.emoji}</span>
                  <div className="display" style={{ fontSize: 26, overflowWrap: 'anywhere' }}>{f.name}</div>
                  <div className="xs muted">{f.college} · {f.city} · {dateRange(f.starts_on, f.ends_on)}</div>
                  <div className="row g8 wrap-row"><span className="badge gray">{catLabel(f.category)}</span><span className="badge green">{num(f.sold)} tickets sold</span></div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </SponsorShell>
  );
}

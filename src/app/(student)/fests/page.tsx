import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { listLiveFests } from '@/lib/queries';
import { Empty, FestCard } from '@/components/ui';

export const metadata = { title: 'Discover fests' };

const CATS = [['all', 'All'], ['cultural', 'Cultural'], ['tech', 'Tech'], ['management', 'Management'], ['sports', 'Sports']];

export default async function Discover({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const { q = '', cat = 'all' } = await searchParams;
  const [user, fests] = await Promise.all([getUser(), listLiveFests({ q, category: cat })]);
  const first = user?.name.split(' ')[0];

  return (
    <div className="wrap stack g16">
      <div className="mt8">
        <span className="kicker">{first ? `Hey ${first}` : 'College fests near you'}</span>
        <h1 className="h2 mt8">What&apos;s on <span className="c-yellow">this season</span></h1>
      </div>

      <form className="row g8" role="search">
        {cat !== 'all' && <input type="hidden" name="cat" value={cat} />}
        <input className="input grow" type="search" name="q" defaultValue={q} placeholder="Search fests, colleges, cities…" aria-label="Search" />
        <button className="btn" type="submit" aria-label="Search">→</button>
      </form>

      <div className="chips">
        {CATS.map(([v, l]) => (
          <Link key={v} className={`chip ${cat === v ? 'on' : ''}`} href={{ pathname: '/fests', query: { ...(q ? { q } : {}), ...(v !== 'all' ? { cat: v } : {}) } }}>{l}</Link>
        ))}
      </div>

      {fests.length === 0 ? (
        <Empty icon="🔍" title="No fests found">{q ? 'Try a different search.' : 'New fests are added every week — check back soon.'}</Empty>
      ) : (
        <div className="grid-auto">
          {fests.map((f) => <FestCard key={f.id} fest={f} minPrice={f.min_price} sold={f.sold} quota={f.quota} />)}
        </div>
      )}

      {!user && (
        <div className="card row between wrap-row g12 mt16">
          <div>
            <div className="h3">Running a fest?</div>
            <div className="small soft">Sell tickets and scan entries free — set up in 5 minutes.</div>
          </div>
          <Link href="/signup?role=organizer" className="btn orange sm">List your fest</Link>
        </div>
      )}
    </div>
  );
}

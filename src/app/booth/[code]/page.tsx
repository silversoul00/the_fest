import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { recordBoothVisit } from './actions';

export const metadata = { title: 'Booth check-in' };

// Students scan the QR poster at a sponsor's booth → this page.
export default async function Booth({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ done?: string }> }) {
  const { code } = await params;
  const { done } = await searchParams;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) notFound();
  const [b] = await sql<{ id: string; brand: string; fest_name: string; emoji: string }[]>`
    select s.id, s.brand, f.name as fest_name, f.emoji from sponsors s join fests f on f.id = s.fest_id where s.booth_code = ${code}`;
  if (!b) notFound();

  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/booth/${code}`)}`);
  const [visited] = await sql`select 1 from sponsor_visits where sponsor_id = ${b.id} and user_id = ${user.id}`;

  return (
    <main className="auth-shell" style={{ ['--accent' as string]: 'var(--blue)' }}>
      <span className="ghost-word" aria-hidden>{b.emoji}</span>
      <div className="stack g24 narrow" style={{ width: '100%', textAlign: 'center', alignItems: 'center', position: 'relative' }}>
        <div className="label">{b.fest_name}</div>
        <div style={{ fontSize: 56 }}>{visited ? '✅' : '🏷️'}</div>
        <h1 className="h1">{b.brand}</h1>
        {visited || done ? (
          <>
            <p className="soft">You&apos;ve checked in at the {b.brand} booth. Enjoy the fest!</p>
            <Link href="/tickets" className="btn outline">My tickets</Link>
          </>
        ) : (
          <form action={recordBoothVisit} className="stack g12" style={{ width: '100%' }}>
            <input type="hidden" name="code" value={code} />
            <p className="soft">Tap to check in at this booth — it takes one second.</p>
            <button className="btn blue block" type="submit">Check in at {b.brand} →</button>
          </form>
        )}
      </div>
    </main>
  );
}

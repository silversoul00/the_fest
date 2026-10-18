import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { BOOTH_CODE_RE, leadsReady } from '@/lib/sponsor-leads';
import { recordBoothVisit, shareLead, stopSharing } from './actions';
import { ShareForm, StopSharingForm } from './LeadForms';
import { VerifyNotice } from '@/components/VerifyNotice';

export const metadata = { title: 'Booth check-in' };

const ERRORS: Record<string, string> = {
  adult: 'Tick "I am 18 or older" to share your contact.',
  verify: 'Confirm your email first (check your inbox), then share.',
  course: 'Keep course & year to 60 characters or fewer.',
  off: 'Sharing isn\'t switched on yet. Your check-in still counts.',
};

// Students scan the QR poster at a sponsor's booth → this page.
export default async function Booth({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ done?: string; err?: string; shared?: string; stopped?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  if (!BOOTH_CODE_RE.test(code)) notFound();
  const withLeads = await leadsReady();
  const [b] = await sql<{ id: string; brand: string; fest_name: string; emoji: string; lead_offer: string | null }[]>`
    select s.id, s.brand, f.name as fest_name, f.emoji, ${withLeads ? sql`s.lead_offer` : sql`null::text`} as lead_offer
    from sponsors s join fests f on f.id = s.fest_id where s.booth_code = ${code}`;
  if (!b) notFound();

  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/booth/${code}`)}`);
  const [visited] = await sql`select 1 from sponsor_visits where sponsor_id = ${b.id} and user_id = ${user.id}`;
  const [lead] = withLeads
    ? await sql<{ shared_at: Date }[]>`select shared_at from sponsor_leads where sponsor_id = ${b.id} and user_id = ${user.id} and withdrawn_at is null`
    : [];
  const checkedIn = !!(visited || sp.done);
  const err = sp.err ? ERRORS[sp.err] : null;
  // Exactly what the brand would get, from the account as it is now (the server snapshots the same fields).
  const items: [string, string][] = [
    ['Name', user.name], ['Email', user.email],
    ...(user.college?.trim() ? [['College', user.college.trim()] as [string, string]] : []),
    ...(user.phone?.trim() ? [['Phone', `${user.phone.trim()} (only if you tick it)`] as [string, string]] : []),
    ['Course & year', 'only if you type it'],
  ];
  const sharedOn = lead ? new Date(lead.shared_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <main className="auth-shell" style={{ ['--accent' as string]: 'var(--blue)' }}>
      <span className="ghost-word" aria-hidden>{b.emoji}</span>
      <div className="stack g24 narrow" style={{ width: '100%', textAlign: 'center', alignItems: 'center', position: 'relative' }}>
        <div className="label">{b.fest_name}</div>
        <div style={{ fontSize: 56 }}>{checkedIn ? '✅' : '🏷️'}</div>
        <h1 className="h1" style={{ overflowWrap: 'anywhere' }}>{b.brand}</h1>
        {checkedIn ? (
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

        {checkedIn && withLeads && (
          <section className="card stack g12" style={{ width: '100%', textAlign: 'left' }} aria-label="Share your contact">
            {err && <div className="alert error" role="alert">{err}</div>}
            {sp.stopped && !lead && <div className="alert ok" role="status">Done — you stopped sharing with {b.brand}.</div>}
            {lead ? (
              <>
                <div className="h3">✓ Shared with {b.brand} on {sharedOn}</div>
                <p className="small muted">You can stop any time here or from My account. If you stop, {b.brand} will be told to delete your details.</p>
                <StopSharingForm action={stopSharing} sponsorId={b.id} from={code} brand={b.brand} />
              </>
            ) : (
              <>
                <div className="h3">Want {b.brand} to contact you?</div>
                {b.lead_offer && <p className="soft" style={{ overflowWrap: 'anywhere' }}>🎁 {b.lead_offer}</p>}
                <p className="small muted">Optional — your check-in already counts. {b.brand} will get:</p>
                <dl className="small lead-items" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
                  {items.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}><dt className="muted">{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd></div>
                  ))}
                </dl>
                <p className="small muted">
                  They&apos;ll use it only to contact you about
                  {' '}{b.brand}&apos;s products, offers and opportunities. THE FEST doesn&apos;t sell your data. You can stop sharing any time from
                  this page or My account. Complaints: Data Protection Board of India. <Link href="/legal/privacy" className="accent">Privacy policy</Link>
                </p>
                {user.verified ? (
                  <ShareForm action={shareLead} code={code} brand={b.brand} hasPhone={!!user.phone?.trim()} />
                ) : (
                  <VerifyNotice email={user.email} why="You can share your contact once your email is confirmed (so the brand gets an address that is really yours). Then open this page again." />
                )}
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

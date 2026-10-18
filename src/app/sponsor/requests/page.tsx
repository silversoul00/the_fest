import { requireUser } from '@/lib/auth';
import { SponsorShell } from '@/components/SponsorShell';
import { RequestCard } from '@/components/RequestCard';
import { VerifyNotice } from '@/components/VerifyNotice';
import { Empty } from '@/components/ui';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { REQUESTS_MISSING, brandRequests, requestsReady } from '@/lib/sponsor-requests';
import { brandDecide } from '../actions';

export const metadata = { title: 'Sponsorship requests' };

export default async function BrandRequests() {
  const user = await requireUser('sponsor');
  const ready = await requestsReady();
  const all = ready ? await brandRequests(user.id) : [];
  const [profile] = ready ? await sql<{ listed: boolean }[]>`select listed from brand_profiles where user_id = ${user.id}` : [];
  const received = all.filter((r) => r.direction === 'org_to_brand');
  const sent = all.filter((r) => r.direction === 'brand_to_org');
  return (
    <SponsorShell user={user} cur="requests">
      <div>
        <span className="kicker" style={{ color: 'var(--blue)' }}>Sponsorship requests</span>
        <h1 className="h2 mt8">Requests</h1>
      </div>
      {!user.verified && <VerifyNotice email={user.email} />}
      {!ready ? <div className="alert error">{REQUESTS_MISSING}</div> : (
        <>
          <section className="stack g12" aria-label="Received">
            <div className="h3">Received ({received.length})</div>
            {received.length === 0 ? (
              <Empty icon="📨" title="No requests received">
                {profile?.listed ? 'Your brand is listed, so organizers can find you. Their requests will show up here.'
                  : <>Organizers can&apos;t find your brand yet. Turn on &ldquo;List my brand&rdquo; in your <Link href="/sponsor/profile">Brand profile</Link>.</>}
              </Empty>
            ) : received.map((r) => <RequestCard key={r.id} r={r} side="brand" action={brandDecide} locked={!user.verified} />)}
          </section>
          <section className="stack g12" aria-label="Sent">
            <div className="h3">Sent ({sent.length})</div>
            {sent.length === 0 ? <Empty icon="📤" title="No requests sent">Open <Link href="/sponsor/fests">Find fests</Link> to see media kits and ask to sponsor.</Empty>
              : sent.map((r) => <RequestCard key={r.id} r={r} side="brand" action={brandDecide} locked={!user.verified} />)}
          </section>
        </>
      )}
    </SponsorShell>
  );
}

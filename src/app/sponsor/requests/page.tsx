import { requireUser } from '@/lib/auth';
import { SponsorShell } from '@/components/SponsorShell';
import { RequestCard } from '@/components/RequestCard';
import { VerifyNotice } from '@/components/VerifyNotice';
import { Empty } from '@/components/ui';
import { REQUESTS_MISSING, brandRequests, requestsReady } from '@/lib/sponsor-requests';
import { brandDecide } from '../actions';

export const metadata = { title: 'Sponsorship requests' };

export default async function BrandRequests() {
  const user = await requireUser('sponsor');
  const ready = await requestsReady();
  const all = ready ? await brandRequests(user.id) : [];
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
            {received.length === 0 ? <Empty icon="📨" title="No requests received">List your brand on your profile so organizers can find you.</Empty>
              : received.map((r) => <RequestCard key={r.id} r={r} side="brand" action={brandDecide} />)}
          </section>
          <section className="stack g12" aria-label="Sent">
            <div className="h3">Sent ({sent.length})</div>
            {sent.length === 0 ? <Empty icon="📤" title="No requests sent">Open Find fests to see media kits and ask to sponsor.</Empty>
              : sent.map((r) => <RequestCard key={r.id} r={r} side="brand" action={brandDecide} />)}
          </section>
        </>
      )}
    </SponsorShell>
  );
}

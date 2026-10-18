import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { dateRange, num } from '@/lib/format';
import { canManage } from '@/lib/queries';
import { ActionForm, Submit } from '@/components/forms';
import { SponsorShell } from '@/components/SponsorShell';
import { RequestFields } from '@/components/RequestCard';
import { VerifyNotice } from '@/components/VerifyNotice';
import { Stat, catLabel } from '@/components/ui';
import { mediaKit, requestsReady, visibleToBrands } from '@/lib/sponsor-requests';
import { requestToSponsor } from '../../actions';

export const metadata = { title: 'Media kit' };

/**
 * A fest's media kit, from real ticket data. Brands see it only while the fest is live, open to sponsors and not over;
 * the fest's own organizers can preview it any time. Everyone else gets 404.
 */
export default async function MediaKit({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser();
  const { festId } = await params;
  if (!isUuid(festId) || user.role === 'student' || !(await requestsReady())) notFound();
  const [f] = await sql<{ id: string; name: string; college: string; city: string; venue: string | null; category: string; starts_on: string; ends_on: string; emoji: string; visible: boolean }[]>`
    select f.id, f.name, f.college, f.city, f.venue, f.category, f.starts_on, f.ends_on, f.emoji, ${visibleToBrands()} as visible
    from fests f where f.id = ${festId}
      and ${user.role === 'sponsor' ? visibleToBrands() : canManage(user)}`;
  if (!f) notFound();
  const kit = await mediaKit(f.id);
  const brand = user.role === 'sponsor';
  const [profile] = brand ? await sql`select 1 from brand_profiles where user_id = ${user.id}` : [];
  const [sponsoring] = brand ? await sql`select 1 from sponsors where fest_id = ${f.id} and email = ${user.email}` : [];

  const body = (
    <>
      {!brand && <div className="alert ok">Preview of what brands see.{!f.visible && ' This fest is hidden from brands right now.'} <Link href={`/organizer/${f.id}/sponsors`}>Back to Sponsors</Link></div>}
      <div>
        <span className="kicker" style={{ color: 'var(--blue)' }}>Media kit · Verified by THE FEST ticketing</span>
        <h1 className="h2 mt8" style={{ overflowWrap: 'anywhere' }}>{f.emoji} {f.name}</h1>
        <p className="small muted mt8">{f.college} · {f.city}{f.venue ? ` · ${f.venue}` : ''} · {dateRange(f.starts_on, f.ends_on)} · {catLabel(f.category)}</p>
      </div>
      <div className="grid-2 grid-3 kit-stats">
        <Stat label="Tickets sold" value={num(kit.tickets)} color="var(--green)" sub={kit.capacity ? `capacity ${num(kit.capacity)}` : undefined} />
        <Stat label="Colleges" value={num(kit.collegeCount)} color="var(--blue)" sub="represented among ticket holders" />
        <Stat label="Host college" value={kit.hostShare == null ? '—' : `${Math.round(kit.hostShare * 100)}%`} sub={`of tickets are from ${f.college}`} />
      </div>
      {kit.prev && <div className="card small">Last fest: <strong>{kit.prev.name}</strong> — {num(kit.prev.checked_in)} checked in at the gate (verified by THE FEST).</div>}
      <section className="card stack g8" aria-label="Top colleges">
        <div className="h3">Top colleges</div>
        {kit.colleges.length === 0 ? <p className="small muted">No tickets sold yet.</p> : (
          <div className="list kit-colleges">
            {kit.colleges.map((c) => <div key={c.college} className="li row between g8"><span style={{ overflowWrap: 'anywhere' }}>{c.college}</span><span className="mono">{num(c.n)}</span></div>)}
          </div>
        )}
        <p className="xs muted">Colleges with fewer than 5 ticket holders are grouped into &ldquo;Other&rdquo;. No student names or emails are shared.</p>
      </section>
      {brand && (
        <section className="card" id="request" aria-label="Request to sponsor">
          <div className="h3 mb8">Request to sponsor</div>
          {sponsoring ? <div className="alert ok already-sponsor">Already a sponsor of this fest. <Link href="/sponsor">Open your sponsorships</Link></div>
            : !user.verified ? <VerifyNotice email={user.email} />
            : !profile ? <Link className="btn blue block" href="/sponsor/profile?need=1">Set up your brand profile first</Link>
            : (
              <ActionForm action={requestToSponsor} resetOnSuccess>
                <input type="hidden" name="festId" value={f.id} />
                <RequestFields deliverablesHint="What you want (stall, mentions…)" />
                <p className="xs muted">The organizers see your brand profile — not your email or phone — until they accept.</p>
                <Submit className="btn blue block">Send request</Submit>
              </ActionForm>
            )}
        </section>
      )}
    </>
  );
  if (brand) return <SponsorShell user={user} cur="fests">{body}</SponsorShell>;
  return <main className="wrap page stack g16">{body}</main>;
}

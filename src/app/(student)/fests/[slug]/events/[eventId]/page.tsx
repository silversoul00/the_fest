import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { eventsReady, festAccess } from '@/lib/fest-access';
import { isUuid } from '@/lib/http';
import { getFestBySlug } from '@/lib/queries';
import { dayLabel, time } from '@/lib/format';
import { EVENT_CATEGORY_LABEL, feeText, slotState, teamText, type EventCategory } from '@/lib/event-format';
import { eventFees } from '@/lib/payments';
import { ActionForm, Submit } from '@/components/forms';
import { registerForEvent } from '../../../../my-events/actions';

export const metadata = { title: 'Event' };

export default async function EventDetail({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  const { slug, eventId } = await params;
  const fest = await getFestBySlug(slug);
  if (!fest || !isUuid(eventId) || !(await eventsReady())) notFound();
  const user = await getUser();
  const runsIt = !!user && (fest.organizer_id === user.id || !!(await festAccess(fest.id, user)));
  if ((fest.status === 'draft' || fest.status === 'review') && !runsIt && !user?.is_admin) notFound();
  const [e] = await sql<{ id: string; title: string; category: string; starts_at: Date; ends_at: Date | null; venue: string; rules: string; prize: string; team_min: number; team_max: number; price_paise: number; needs_ticket: boolean; mixed_colleges: boolean; slots: number; taken: number; reg_deadline: Date }[]>`
    select e.id, e.title, e.category, e.starts_at, e.ends_at, e.venue, e.rules, e.prize, e.team_min, e.team_max, e.price_paise, e.needs_ticket,
           e.mixed_colleges, e.slots, tt.sold as taken, e.reg_deadline
    from events e join ticket_types tt on tt.id = e.ticket_type_id where e.id = ${eventId} and e.fest_id = ${fest.id} and e.active`;
  if (!e) notFound();
  const [mine] = user ? await sql<{ status: string }[]>`
    select r.status from event_members m join event_regs r on r.id = m.reg_id
    where m.event_id = ${e.id} and m.user_id = ${user.id} and m.status = 'joined'` : [];
  const st = slotState(e.taken, e.slots, e.reg_deadline);
  const team = e.team_max > 1;
  const fee = eventFees().flatPaise;
  const open = st.kind === 'open' && fest.status === 'live';

  return (
    <div className="wrap stack g16 ev-ui" style={{ '--fest': fest.accent, maxWidth: 640 } as CSSProperties}>
      <Link href={`/fests/${fest.slug}#events`} className="label">← {fest.name}</Link>
      <div className="row g8 wrap-row">
        <span className="badge gray">{EVENT_CATEGORY_LABEL[e.category as EventCategory]}</span>
        <span className={`badge ${st.kind === 'open' ? 'green' : st.kind === 'full' ? 'orange' : 'gray'}`} data-slots>{st.text}</span>
      </div>
      <h1 className="h2 wrap-anywhere">{e.title}</h1>
      <div className="stack g4 small soft">
        <span>📅 {dayLabel(e.starts_at)}, {time(e.starts_at)}{e.ends_at ? ` – ${time(e.ends_at)}` : ''}</span>
        {e.venue && <span>📍 {e.venue}</span>}
        <span>👥 {teamText(e.team_min, e.team_max)}</span>
        <span data-fee>🎟️ {feeText(e.price_paise, e.needs_ticket, fee, team)}</span>
        <span>⏰ Registration closes {dayLabel(e.reg_deadline)}, {time(e.reg_deadline)}</span>
        {team && <span>{e.mixed_colleges ? 'Teams can mix students from different colleges.' : 'Every member must be from the captain’s college (as written on their profile).'}</span>}
      </div>
      {e.prize && <div className="card tight"><div className="label mb8">Prize</div><div className="wrap-anywhere">{e.prize}</div></div>}
      {e.rules && <div className="card tight"><div className="label mb8">Rules</div><div className="small soft wrap-anywhere" style={{ whiteSpace: 'pre-line' }}>{e.rules}</div></div>}

      <div className="card stack g12" id="register">
        {mine && (mine.status === 'forming' || mine.status === 'confirmed') ? (
          <>
            <div className="alert ok">{mine.status === 'confirmed' ? 'You’re in this event.' : 'You have an entry in progress.'}</div>
            <Link href="/my-events" className="btn block">Open My events →</Link>
          </>
        ) : !user ? (
          <Link href={`/login?next=${encodeURIComponent(`/fests/${fest.slug}/events/${e.id}`)}`} className="btn block">Log in to register →</Link>
        ) : user.role !== 'student' ? (
          <div className="alert info">Events are entered from a student account.</div>
        ) : !open ? (
          <div className="alert info">{st.kind === 'full' ? 'This event is full.' : st.kind === 'closed' ? 'Registration for this event has closed.' : 'Registrations are not open yet.'}</div>
        ) : (
          <ActionForm action={registerForEvent}>
            <input type="hidden" name="eventId" value={e.id} />
            {team && <label className="field"><span>Team name</span><input className="input" name="team_name" required minLength={2} maxLength={60} placeholder="The Rockers" /></label>}
            {team && <p className="xs muted">You’re the captain and member 1. Next, invite your teammates by email from My events{e.price_paise ? '; you pay once for the whole team' : ''}.</p>}
            <Submit pendingText="Registering…">{team ? 'Create team →' : e.price_paise ? 'Register & pay →' : 'Register →'}</Submit>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

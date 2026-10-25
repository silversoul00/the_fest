import Link from 'next/link';
import { sql } from '@/lib/db';
import { eventAllowed, eventPageAccess } from '@/lib/fest-access';
import { dayLabel, rupees, time } from '@/lib/format';
import { EVENT_CATEGORY_LABEL, istDate, istTime, teamText, type EventCategory } from '@/lib/event-format';
import { ActionForm, FlashMessage, Submit } from '@/components/forms';
import { holdLive, takenLive } from '@/lib/holds';
import { deleteFestEvent, markEventPresent, removeEventEntry, toggleFestEvent, updateFestEvent } from '../../../events-actions';
import { EventFields } from '../EventFields';

export const metadata = { title: 'Event' };

type Ev = {
  id: string; title: string; category: string; starts_at: Date; ends_at: Date | null; venue: string; rules: string; prize: string;
  team_min: number; team_max: number; price_paise: number; slots: number; reg_deadline: Date; mixed_colleges: boolean; needs_ticket: boolean;
  active: boolean; taken: number; entries: number;
};
type Member = { id: string; reg_id: string; name: string | null; email: string; college: string | null; status: string; checked_in_at: Date | null; is_captain: boolean };
type Entry = { id: string; team_name: string | null; status: string; captain: string; paid: number | null; pending: boolean };

export default async function EventPage({ params }: { params: Promise<{ festId: string; eventId: string }> }) {
  const p = await params;
  const { fest, access, eventId } = await eventPageAccess(p.festId, p.eventId, 'view');
  const manage = eventAllowed(access, eventId, 'manage');
  const all = access.perms.has('events');
  const money = access.perms.has('money');  // no ₹ for roles without money (event heads, judges)
  const [e] = await sql<Ev[]>`
    select e.*, ${takenLive(sql)} as taken, (select count(*) from event_regs r where r.event_id = e.id)::int as entries
    from events e join ticket_types tt on tt.id = e.ticket_type_id where e.id = ${eventId}`;
  const entries = await sql<Entry[]>`
    select r.id, r.team_name, r.status, u.name as captain,
           (select o.amount_paise - o.refunded_paise from orders o where o.registration_id = r.id and o.status in ('paid', 'refunded') order by o.created_at desc limit 1) as paid,
           exists (select 1 from orders o where o.registration_id = r.id and ${holdLive(sql)}) as pending
    from event_regs r join users u on u.id = r.captain_id
    where r.event_id = ${eventId} order by (r.status = 'confirmed') desc, r.created_at`;
  const members = await sql<Member[]>`
    select m.id, m.reg_id, case when m.status = 'joined' then u.name end as name, m.email::text, case when m.status = 'joined' then u.college end as college, m.status, m.checked_in_at, (m.user_id = r.captain_id) as is_captain
    from event_members m join event_regs r on r.id = m.reg_id left join users u on u.id = m.user_id
    where m.event_id = ${eventId} and m.status in ('joined', 'invited') order by m.invited_at`;
  const confirmed = entries.filter((x) => x.status === 'confirmed').length;
  const team = e.team_max > 1;

  return (
    <div className="stack g16 ev-ui">
      <Link href={`/organizer/${fest.id}/events`} className="label">← Events</Link>
      <div className="row between g8 wrap-row">
        <h1 className="h2 wrap-anywhere">{e.title}</h1>
        {!e.active && <span className="badge gray">Hidden</span>}
      </div>
      <p className="small soft">{EVENT_CATEGORY_LABEL[e.category as EventCategory]} · {dayLabel(e.starts_at)} {time(e.starts_at)}{e.venue ? ` · ${e.venue}` : ''} · {teamText(e.team_min, e.team_max)} · {e.price_paise ? `${money ? rupees(e.price_paise) : 'Paid'}${team ? ' per team' : ''}` : 'Free'}</p>
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="stat" style={{ padding: 12 }}><div className="label">Slots taken</div><div className="v" style={{ fontSize: 26 }} data-taken>{e.taken}/{e.slots}</div></div>
        <div className="stat" style={{ padding: 12 }}><div className="label">Confirmed</div><div className="v" style={{ fontSize: 26 }}>{confirmed}</div></div>
        <div className="stat" style={{ padding: 12 }}><div className="label">Present</div><div className="v" style={{ fontSize: 26 }}>{members.filter((m) => m.checked_in_at).length}</div></div>
      </div>

      <FlashMessage />
      <section className="card" id="entries">
        <div className="row between g8 wrap-row mb16">
          <div className="h3">Entries</div>
          {manage && <a className="btn sm outline" href={`/organizer/${fest.id}/events/${eventId}/export`} data-export>⬇ CSV</a>}
        </div>
        {!entries.length ? <p className="small muted">No entries yet.</p> : (
          <div className="stack g12">
            {entries.map((r) => (
              <div key={r.id} className="card tight stack g8" style={{ background: 'var(--black)' }} data-entry={r.team_name ?? r.captain}>
                <div className="row between g8 wrap-row">
                  <strong className="wrap-anywhere">{r.team_name ?? r.captain}</strong>
                  <span className={`badge ${r.status === 'confirmed' ? 'green' : r.status === 'forming' ? 'yellow' : 'gray'}`}>
                    {r.status === 'forming' ? (r.pending ? 'Payment pending' : 'Forming') : r.status === 'confirmed' ? 'Confirmed' : r.status === 'refunded' ? 'Refunded' : 'Withdrawn'}
                  </span>
                </div>
                {r.paid !== null && <div className="xs muted">Paid{money ? ` ${rupees(r.paid)}` : ''}</div>}
                {members.filter((m) => m.reg_id === r.id).map((m) => (
                  <div key={m.id} className="row g8 wrap-row small" data-member={m.name ?? m.email}>
                    <span className="grow wrap-anywhere">{m.name ?? (manage ? m.email : 'Invited')}{m.is_captain && team ? ' (captain)' : ''}{m.status === 'invited' ? ' · invited' : ''}
                      <span className="xs muted">{m.college ? ` · ${m.college}` : ''}{manage && m.name ? ` · ${m.email}` : ''}</span></span>
                    {m.checked_in_at ? <span className="badge green" title={`${time(m.checked_in_at)}`}>Present ✓</span>
                      : manage && m.status === 'joined' && r.status === 'confirmed' && (
                        <form action={markEventPresent}>
                          <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="memberId" value={m.id} />
                          <button className="btn sm outline" style={{ minHeight: 44 }} aria-label={`Mark ${m.name ?? m.email} present`}>Mark present</button>
                        </form>
                      )}
                  </div>
                ))}
                {manage && r.paid !== null && r.status === 'confirmed' && <p className="xs muted">Paid entry — {money ? 'cancel it with a refund from Sales.' : 'the owner or Finance lead can refund it from Sales.'}</p>}
                {manage && r.paid === null && (r.status === 'confirmed' || r.status === 'forming') && (
                  <ActionForm action={removeEventEntry} className="row g8" flash>
                    <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="regId" value={r.id} />
                    <Submit className="btn text xs" pendingText="Removing…">Remove entry</Submit>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {manage && (
        <section className="card" id="edit-event">
          <div className="h3 mb16">Edit event</div>
          <ActionForm action={updateFestEvent}>
            <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="eventId" value={eventId} />
            <EventFields money={all} festStart={fest.starts_on} festEnd={fest.ends_on} locked={e.entries > 0} taken={e.taken}
              v={{ title: e.title, category: e.category, date: istDate(e.starts_at), start: istTime(e.starts_at), end: e.ends_at ? istTime(e.ends_at) : '',
                   venue: e.venue, rules: e.rules, prize: e.prize, team_min: e.team_min, team_max: e.team_max, price: e.price_paise / 100, slots: e.slots,
                   deadline_date: istDate(e.reg_deadline), deadline_time: istTime(e.reg_deadline), mixed_colleges: e.mixed_colleges, needs_ticket: e.needs_ticket }} />
            <Submit className="btn">Save event</Submit>
          </ActionForm>
        </section>
      )}

      {all && (
        <section className="card row g8 wrap-row">
          <form action={toggleFestEvent}>
            <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="eventId" value={eventId} />
            <button className="btn outline" style={{ minHeight: 44 }}>{e.active ? 'Hide from students' : 'Show to students'}</button>
          </form>
          <ActionForm action={deleteFestEvent} className="row g8">
            <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="eventId" value={eventId} />
            <Submit className="btn outline" pendingText="Deleting…">Delete event</Submit>
          </ActionForm>
          <p className="xs muted" style={{ flexBasis: '100%' }}>An event with entries can’t be deleted — hide it instead. Paid entries are refunded from Sales by the owner or Finance lead.</p>
        </section>
      )}
    </div>
  );
}

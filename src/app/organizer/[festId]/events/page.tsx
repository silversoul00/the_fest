import Link from 'next/link';
import { sql } from '@/lib/db';
import { eventsReady, EVENTS_MISSING, pageAccess } from '@/lib/fest-access';
import { dayLabel, rupees, time } from '@/lib/format';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABEL, teamText } from '@/lib/event-format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty } from '@/components/ui';
import { addFestEvent } from '../../events-actions';
import { EventFields } from './EventFields';

export const metadata = { title: 'Events' };

type Row = { id: string; title: string; category: string; starts_at: Date; reg_deadline: Date; team_min: number; team_max: number; price_paise: number; slots: number; taken: number; active: boolean; entries: number };

export default async function EventsTab({ params, searchParams }: { params: Promise<{ festId: string }>; searchParams: Promise<{ deleted?: string }> }) {
  const { fest, access } = await pageAccess((await params).festId, 'events_view');
  const sp = await searchParams;
  if (!(await eventsReady())) return <div className="stack g16"><h1 className="h2">Events</h1><div className="alert info">{EVENTS_MISSING}</div></div>;
  const all = access.perms.has('events');
  const money = access.perms.has('money');  // no ₹ for roles without money (event heads, judges)
  const mine = [...access.headOf, ...access.judgeOf];
  const rows = all || mine.length ? await sql<Row[]>`
    select e.id, e.title, e.category, e.starts_at, e.reg_deadline, e.team_min, e.team_max, e.price_paise, e.slots, tt.sold as taken, e.active,
           (select count(*) from event_regs r where r.event_id = e.id and r.status in ('forming', 'confirmed'))::int as entries
    from events e join ticket_types tt on tt.id = e.ticket_type_id
    where e.fest_id = ${fest.id} ${all ? sql`` : sql`and e.id in ${sql(mine)}`}
    order by e.starts_at, e.title` : [];

  return (
    <div className="stack g16 ev-ui">
      <h1 className="h2">Events</h1>
      {sp.deleted && <div className="alert ok" role="status">Event deleted.</div>}
      {!all && !mine.length && <div className="alert info">You’re not linked to an event yet. Ask the organizer to pick your event under Team.</div>}

      {EVENT_CATEGORIES.map((c) => {
        const list = rows.filter((r) => r.category === c);
        if (!list.length) return null;
        return (
          <section key={c} data-category={c}>
            <div className="label mb8">{EVENT_CATEGORY_LABEL[c]}</div>
            <div className="list">
              {list.map((e) => (
                <Link key={e.id} href={`/organizer/${fest.id}/events/${e.id}`} className="li" style={{ minHeight: 44 }} data-event={e.title}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row g8 wrap-row"><strong className="wrap-anywhere">{e.title}</strong>{!e.active && <span className="badge gray">Hidden</span>}</div>
                    <div className="xs muted">{dayLabel(e.starts_at)} {time(e.starts_at)} · {teamText(e.team_min, e.team_max)} · {e.price_paise ? (money ? rupees(e.price_paise) : 'Paid') : 'Free'} · closes {dayLabel(e.reg_deadline)} {time(e.reg_deadline)}</div>
                  </div>
                  <span className={`badge ${e.taken >= e.slots ? 'orange' : 'gray'}`} data-taken>{e.taken}/{e.slots}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {(all || mine.length > 0) && !rows.length && <Empty icon="🏆" title="No events yet">{all ? 'Add your first event below — students see it on your fest page.' : ''}</Empty>}

      {all && (
        <div className="card" id="add-event">
          <div className="h3 mb16">Add an event</div>
          <ActionForm action={addFestEvent} resetOnSuccess>
            <input type="hidden" name="festId" value={fest.id} />
            <EventFields money festStart={fest.starts_on} festEnd={fest.ends_on}
              v={{ title: '', category: 'cultural', date: fest.starts_on, start: '10:00', end: '', venue: '', rules: '', prize: '', team_min: 1, team_max: 1, price: 0, slots: 0, deadline_date: '', deadline_time: '', mixed_colleges: true, needs_ticket: false }} />
            <Submit className="btn">+ Add event</Submit>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

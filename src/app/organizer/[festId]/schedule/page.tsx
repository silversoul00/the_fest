import { pageAccess } from '@/lib/fest-access';
import { getSchedule } from '@/lib/queries';
import { dayLabel, time } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty } from '@/components/ui';
import type { ScheduleEvent } from '@/lib/types';
import { addEvent, deleteEvent } from '../../actions';

export default async function Schedule({ params }: { params: Promise<{ festId: string }> }) {
  const { fest, access } = await pageAccess((await params).festId, 'schedule_view');
  const canEdit = access.perms.has('schedule');
  const events = await getSchedule(fest.id);
  const days = new Map<string, ScheduleEvent[]>();
  for (const e of events) days.set(dayLabel(e.starts_at), [...(days.get(dayLabel(e.starts_at)) ?? []), e]);

  // Clash detection: same venue, overlapping time
  const clashes = new Set<string>();
  for (const a of events) for (const b of events) {
    if (a.id < b.id && a.venue && a.venue === b.venue && a.starts_at < b.ends_at && b.starts_at < a.ends_at) { clashes.add(a.id); clashes.add(b.id); }
  }

  return (
    <div className="stack g16">
      <h1 className="h2">Schedule</h1>

      {canEdit && <div className="card">
        <div className="h3 mb16">Add an event</div>
        <ActionForm action={addEvent} resetOnSuccess>
          <input type="hidden" name="festId" value={fest.id} />
          <div className="form-row">
            <label className="field"><span>Title</span><input className="input" name="title" required placeholder="Battle of Bands — Finals" /></label>
            <label className="field"><span>Venue</span><input className="input" name="venue" placeholder="Main Stage" /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>Date</span><input className="input" type="date" name="date" required min={fest.starts_on} max={fest.ends_on} defaultValue={fest.starts_on} /></label>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="field"><span>Start</span><input className="input" type="time" name="start" required defaultValue="10:00" /></label>
              <label className="field"><span>End</span><input className="input" type="time" name="end" required defaultValue="12:00" /></label>
            </div>
          </div>
          <Submit className="btn">+ Add to schedule</Submit>
        </ActionForm>
      </div>}

      {clashes.size > 0 && <div className="alert error">⚠ {clashes.size} events overlap at the same venue — highlighted below.</div>}

      {events.length === 0 ? <Empty icon="📅" title="No events yet">{canEdit ? 'Add your first event above — students see it on your fest page.' : 'The organizers haven’t added events yet.'}</Empty> : (
        [...days].map(([d, evs]) => (
          <div key={d}>
            <div className="label mb8">{d}</div>
            <div className="list">
              {evs.map((e) => (
                <div key={e.id} className="li" style={clashes.has(e.id) ? { background: 'rgba(255,45,85,.07)' } : undefined}>
                  <span className="mono xs c-yellow" style={{ width: 120, flexShrink: 0 }}>{time(e.starts_at)} – {time(e.ends_at)}</span>
                  <div className="grow"><div>{e.title}</div><div className="xs muted">{e.venue}{clashes.has(e.id) && <span className="c-red"> · clash</span>}</div></div>
                  {canEdit && <form action={deleteEvent}>
                    <input type="hidden" name="festId" value={fest.id} />
                    <input type="hidden" name="id" value={e.id} />
                    <button className="btn text xs" style={{ color: 'var(--red)' }} aria-label={`Delete ${e.title}`}>Remove</button>
                  </form>}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

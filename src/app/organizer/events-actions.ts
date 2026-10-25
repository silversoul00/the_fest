'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { clip, rupees } from '@/lib/format';
import { isUuid } from '@/lib/http';
import { actorOf, eventsReady, EVENTS_MISSING, logActivity, requireEventPerm, requirePerm } from '@/lib/fest-access';
import { EVENT_CATEGORY_LABEL, LIMITS, isEventCategory, teamText } from '@/lib/event-format';
import { markPresentManual, withdrawEntry } from '@/lib/events';
import type { ActionState } from '@/lib/types';
import type { OwnFest } from '@/lib/fest-access';

/*
 * Organizer → Events tab (v2.8). Every action checks who is calling (scripts/check-guards.mjs):
 *  • add / hide / delete: requirePerm(fd, 'events') — owner, co-organizer;
 *  • edit, remove an entry, mark present: requireEventPerm(fd, 'manage') — `events` perm, or that event's Event head.
 * Event heads can't change the fee, slots or "fest ticket needed" (money and capacity stay with owner/co-organizer).
 */

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const MAX_EVENTS = 200;
const IST = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const log = (g: Parameters<typeof actorOf>[0], action: string, summary: string, detail: Record<string, unknown> = {}) => logActivity(actorOf(g), action, summary, detail);
const refresh = (festId: string) => { revalidatePath(`/organizer/${festId}`, 'layout'); revalidatePath('/fests', 'layout'); };

type Fields = {
  title: string; category: string; starts_at: Date; ends_at: Date | null; venue: string; rules: string; prize: string;
  team_min: number; team_max: number; price_paise: number; slots: number; reg_deadline: Date; mixed_colleges: boolean; needs_ticket: boolean;
};

/** Read and check the event form. `money` = may set fee / slots / needs-ticket (else `keep` supplies them). */
function parse(fd: FormData, fest: OwnFest, money: boolean, keep?: Pick<Fields, 'price_paise' | 'slots' | 'needs_ticket'>): Fields | { error: string } {
  const title = s(fd, 'title');
  if ([...title].length < 2 || [...title].length > LIMITS.title) return { error: `Event name: 2 to ${LIMITS.title} characters.` };
  const category = s(fd, 'category');
  if (!isEventCategory(category)) return { error: 'Pick a category.' };
  const date = s(fd, 'date'), start = s(fd, 'start'), end = s(fd, 'end');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) return { error: 'Pick the event’s date and start time.' };
  if (date < fest.starts_on || date > fest.ends_on) return { error: 'The event date must be one of the fest days.' };
  const starts_at = IST(date, start);
  let ends_at: Date | null = null;
  if (end) {
    if (!/^\d{2}:\d{2}$/.test(end)) return { error: 'End time looks wrong.' };
    ends_at = IST(date, end);
    if (ends_at <= starts_at) ends_at = new Date(ends_at.getTime() + 864e5); // ends after midnight
  }
  const venue = s(fd, 'venue'), rules = String(fd.get('rules') ?? '').trim(), prize = s(fd, 'prize');
  if (venue.length > LIMITS.venue) return { error: `Venue: at most ${LIMITS.venue} characters.` };
  if (rules.length > LIMITS.rules) return { error: `Rules: at most ${LIMITS.rules} characters.` };
  if (prize.length > LIMITS.prize) return { error: `Prize: at most ${LIMITS.prize} characters.` };
  const team = s(fd, 'format') === 'team';
  const team_min = team ? Number(s(fd, 'team_min')) : 1, team_max = team ? Number(s(fd, 'team_max')) : 1;
  if (team && (!Number.isInteger(team_min) || !Number.isInteger(team_max) || team_min < 1 || team_max < 2 || team_max > LIMITS.maxTeam || team_min > team_max)) {
    return { error: `Team size: at least 1, at most ${LIMITS.maxTeam}, and the minimum can’t be above the maximum (a team needs a maximum of 2 or more).` };
  }
  let price_paise = keep?.price_paise ?? 0, slots = keep?.slots ?? 0, needs_ticket = keep?.needs_ticket ?? false;
  if (money) {
    const fee = s(fd, 'fee') === 'paid';
    const rs = Number(s(fd, 'price') || 0);
    price_paise = fee ? Math.round(rs * 100) : 0;
    if (fee && (!Number.isFinite(rs) || price_paise < 100 || price_paise > LIMITS.maxPricePaise)) return { error: 'Entry fee: between ₹1 and ₹10,000 (or choose Free).' };
    slots = Number(s(fd, 'slots'));
    if (!Number.isInteger(slots) || slots < 1 || slots > LIMITS.maxSlots) return { error: `Slots: a whole number from 1 to ${LIMITS.maxSlots.toLocaleString('en-IN')}.` };
    needs_ticket = fd.get('needs_ticket') === 'on';
  }
  const dd = s(fd, 'deadline_date'), dt = s(fd, 'deadline_time');
  let reg_deadline = starts_at;
  if (dd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dd) || (dt && !/^\d{2}:\d{2}$/.test(dt))) return { error: 'Registration deadline looks wrong.' };
    reg_deadline = IST(dd, dt || '23:59');
    if (reg_deadline > starts_at) return { error: 'The registration deadline can’t be after the event starts.' };
  }
  return { title, category, starts_at, ends_at, venue, rules, prize, team_min, team_max, price_paise, slots, reg_deadline, mixed_colleges: fd.get('mixed_colleges') === 'on', needs_ticket };
}

export async function addFestEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await requirePerm(fd, 'events');
  const { fest } = g;
  if (!(await eventsReady())) return { error: EVENTS_MISSING };
  const f = parse(fd, fest, true);
  if ('error' in f) return f;
  const r = await sql.begin(async (tx) => {
    await tx`select 1 from fests where id = ${fest.id} for update`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from events where fest_id = ${fest.id}`;
    if (n >= MAX_EVENTS) return { error: `A fest can have up to ${MAX_EVENTS} events.` };
    // The hidden slot counter / checkout item for this event (never shown as a ticket)
    const [tt] = await tx<{ id: string }[]>`
      insert into ticket_types (fest_id, name, description, price_paise, quota, sold, sort, kind)
      values (${fest.id}, ${clip('Event: ' + f.title, 90)}, '', ${f.price_paise}, ${f.slots}, 0, 1000, 'event') returning id`;
    const [e] = await tx<{ id: string }[]>`
      insert into events (fest_id, category, title, starts_at, ends_at, venue, rules, prize, team_min, team_max, price_paise, slots,
                          reg_deadline, mixed_colleges, needs_ticket, ticket_type_id)
      values (${fest.id}, ${f.category}, ${f.title}, ${f.starts_at}, ${f.ends_at}, ${f.venue}, ${f.rules}, ${f.prize}, ${f.team_min}, ${f.team_max},
              ${f.price_paise}, ${f.slots}, ${f.reg_deadline}, ${f.mixed_colleges}, ${f.needs_ticket}, ${tt.id})
      returning id`;
    return { id: e.id };
  });
  if ('error' in r) return { error: r.error as string };
  await log(g, 'event.add', `Added the event “${f.title}” (${EVENT_CATEGORY_LABEL[f.category as keyof typeof EVENT_CATEGORY_LABEL]}, ${teamText(f.team_min, f.team_max)}, ${f.price_paise ? rupees(f.price_paise) : 'free'}, ${f.slots} slots)`, { event: r.id });
  refresh(fest.id);
  return { ok: true, message: `“${f.title}” added. Students see it on your fest page.` };
}

export async function updateFestEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await requireEventPerm(fd, 'manage');
  const { fest, eventId } = g;
  const money = g.access.perms.has('events');
  const r = await sql.begin(async (tx) => {
    const [cur] = await tx<{ ticket_type_id: string; sold: number; price_paise: number; slots: number; needs_ticket: boolean; team_min: number; team_max: number; entries: number }[]>`
      select e.ticket_type_id, tt.sold, e.price_paise, e.slots, e.needs_ticket, e.team_min, e.team_max,
             (select count(*)::int from event_regs r where r.event_id = e.id) as entries
      from events e join ticket_types tt on tt.id = e.ticket_type_id where e.id = ${eventId} for update of tt`;
    const f = parse(fd, fest, money, cur);
    if ('error' in f) return f;
    // Once someone has entered, the fee and team size stay as they were (people signed up for those)
    if (cur.entries > 0 && (f.price_paise !== cur.price_paise || f.team_min !== cur.team_min || f.team_max !== cur.team_max)) {
      return { error: 'The fee and team size can’t change after the first entry. Hide this event and add a new one if you must.' };
    }
    if (f.slots < cur.sold) return { error: `${cur.sold} slots are already taken — slots can’t go below that.` };
    await tx`update events set category = ${f.category}, title = ${f.title}, starts_at = ${f.starts_at}, ends_at = ${f.ends_at}, venue = ${f.venue},
               rules = ${f.rules}, prize = ${f.prize}, team_min = ${f.team_min}, team_max = ${f.team_max}, price_paise = ${f.price_paise},
               slots = ${f.slots}, reg_deadline = ${f.reg_deadline}, mixed_colleges = ${f.mixed_colleges}, needs_ticket = ${f.needs_ticket}
             where id = ${eventId}`;
    await tx`update ticket_types set name = ${clip('Event: ' + f.title, 90)}, price_paise = ${f.price_paise}, quota = ${f.slots} where id = ${cur.ticket_type_id}`;
    // Event-head / judge roles linked to this event show its (new) name
    await tx`update fest_roles set scope_label = ${clip(f.title, 60)} where event_id = ${eventId}`;
    return { title: f.title };
  });
  if ('error' in r) return { error: r.error as string };
  await log(g, 'event.edit', `Edited the event “${r.title}”`, { event: eventId });
  refresh(fest.id);
  return { ok: true, message: 'Event saved.' };
}

export async function toggleFestEvent(fd: FormData) {
  const g = await requirePerm(fd, 'events');
  const id = s(fd, 'eventId');
  if (!isUuid(id) || !(await eventsReady())) return;
  const [e] = await sql<{ title: string; active: boolean }[]>`update events set active = not active where id = ${id} and fest_id = ${g.fest.id} returning title, active`;
  if (e) await log(g, 'event.hide', `${e.active ? 'Showed' : 'Hid'} the event “${e.title}”`, { event: id, active: e.active });
  refresh(g.fest.id);
}

/** Delete only an event nobody entered; otherwise hide it. */
export async function deleteFestEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await requirePerm(fd, 'events');
  const id = s(fd, 'eventId');
  if (!isUuid(id) || !(await eventsReady())) return { error: 'Event not found.' };
  const r = await sql.begin(async (tx) => {
    const [e] = await tx<{ title: string; ticket_type_id: string }[]>`select title, ticket_type_id from events where id = ${id} and fest_id = ${g.fest.id} for update`;
    if (!e) return { error: 'Event not found.' };
    const [x] = await tx`select 1 from event_regs where event_id = ${id} limit 1`;
    if (x) return { error: 'This event has entries — hide it instead.' };
    await tx`delete from events where id = ${id}`;
    await tx`delete from ticket_types where id = ${e.ticket_type_id} and kind = 'event'`;
    return { title: e.title };
  });
  if ('error' in r) return { error: r.error as string };
  await log(g, 'event.delete', `Deleted the event “${r.title}”`, { event: id });
  refresh(g.fest.id);
  redirect(`/organizer/${g.fest.id}/events?deleted=1`);
}

/** Remove an entry from the roster (before the deadline; never a paid one — that's a refund). */
export async function removeEventEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await requireEventPerm(fd, 'manage');
  const regId = s(fd, 'regId');
  if (!isUuid(regId)) return { error: 'Entry not found.' };
  const r = await withdrawEntry(regId, { byOrganizer: { festId: g.fest.id, eventId: g.eventId } });
  if ('error' in r) return r;
  const [e] = await sql<{ title: string; team: string | null; captain: string }[]>`
    select e.title, r.team_name as team, u.name as captain from event_regs r join events e on e.id = r.event_id join users u on u.id = r.captain_id where r.id = ${regId}`;
  await log(g, 'event.entry_remove', `Removed ${e.team ? `team “${e.team}”` : e.captain}'s entry from “${e.title}”`, { event: g.eventId, reg: regId });
  refresh(g.fest.id);
  return { ok: true, message: r.message };
}

/** "Mark present" by hand, for a member with no fest ticket to scan. */
export async function markEventPresent(fd: FormData) {
  const g = await requireEventPerm(fd, 'manage');
  const memberId = s(fd, 'memberId');
  if (!isUuid(memberId)) return;
  const name = await markPresentManual(g.eventId, memberId, g.user.id);
  if (name) {
    const [e] = await sql<{ title: string }[]>`select title from events where id = ${g.eventId}`;
    await log(g, 'event.mark_present', `Marked ${name} present at “${e.title}”`, { event: g.eventId, member: memberId });
  }
  refresh(g.fest.id);
}

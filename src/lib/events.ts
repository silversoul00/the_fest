import 'server-only';
import type postgres from 'postgres';
import { sql } from './db';
import { sameCollege } from './event-format';
import { activeRole } from './fest-access';
import { holdLive, releaseHolds } from './holds';
import { time } from './format';
import type { User } from './types';

/*
 * Fest events, part A (v2.8, Oct 2026) — docs/team/research/2026-10-25-fest-events.md.
 * One rule for slots: the event's hidden "shadow" ticket_types row (kind 'event', quota = slots, sold = slots taken)
 * is the only counter. A slot is taken when an entry is confirmed (free: Register / Submit team) or, for a paid event,
 * when the captain's order is created (a 15/30-minute hold, exactly like tickets). Forming teams hold no slot.
 * Every write locks in the same order: shadow ticket_types row → event_regs row; `sold <= quota` is the last guard.
 * One team per student per event is a unique index (event_members_one_team).
 */

type Tx = postgres.TransactionSql;
export type Result = { ok: true; message: string; regId?: string } | { error: string };

export type EvRow = {
  id: string; fest_id: string; title: string; price_paise: number; team_min: number; team_max: number; slots: number;
  reg_deadline: Date; mixed_colleges: boolean; needs_ticket: boolean; active: boolean; ticket_type_id: string;
  sold: number; quota: number; fest_status: string; fest_name: string; starts_at: Date;
};

const EV_COLS = (tx: Tx) => tx`
  e.id, e.fest_id, e.title, e.price_paise, e.team_min, e.team_max, e.slots, e.reg_deadline, e.mixed_colleges, e.needs_ticket,
  e.active, e.ticket_type_id, e.starts_at, tt.sold, tt.quota, f.status::text as fest_status, f.name as fest_name`;

/**
 * Lock the event's slot counter (first lock of every write) and return the event. Expired payment holds are released
 * here (same 15/30-minute rule as tickets), so an abandoned checkout never keeps a slot taken or a team frozen.
 */
async function lockEvent(tx: Tx, eventId: string): Promise<EvRow | undefined> {
  const [e] = await tx<EvRow[]>`
    select ${EV_COLS(tx)} from events e join ticket_types tt on tt.id = e.ticket_type_id join fests f on f.id = e.fest_id
    where e.id = ${eventId} for update of tt`;
  if (e) e.sold = Math.max(e.sold - (await releaseHolds(tx, e.ticket_type_id)), 0);
  return e;
}

type RegRow = { id: string; event_id: string; captain_id: string; status: string; team_name: string | null; captain_college: string | null };
/** Lock an entry (second lock). */
async function lockReg(tx: Tx, regId: string): Promise<RegRow | undefined> {
  const [r] = await tx<RegRow[]>`
    select r.id, r.event_id, r.captain_id, r.status, r.team_name, u.college as captain_college
    from event_regs r join users u on u.id = r.captain_id where r.id = ${regId} for update of r`;
  return r;
}
/** The entry's event id without locking (to know which shadow row to lock first). */
const eventOfReg = async (regId: string) => (await sql<{ event_id: string }[]>`select event_id from event_regs where id = ${regId}`)[0]?.event_id;

const closed = (e: EvRow) => e.reg_deadline.getTime() <= Date.now();
const notOpen = (e: EvRow) =>
  e.fest_status !== 'live' ? 'Registrations are not open for this fest.' : !e.active ? 'This event is not taking entries.' : closed(e) ? 'Registration for this event has closed.' : null;
const joinedCount = async (tx: Tx, regId: string) =>
  (await tx<{ n: number }[]>`select count(*)::int n from event_members where reg_id = ${regId} and status = 'joined'`)[0].n;
const openOrder = async (tx: Tx, regId: string) =>
  (await tx<{ status: string }[]>`select o.status::text from orders o where o.registration_id = ${regId} and (o.status = 'paid' or ${holdLive(tx, 'o')})
                                  order by (o.status = 'paid') desc limit 1`)[0]?.status;
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';
const ALREADY = 'You’re already in a team for this event.';

/** Can this student be in this event's team (fest ticket, college rule)? `who` names them in the message. */
async function memberProblem(tx: Tx, e: EvRow, userId: string, captainCollege: string | null, who: string | null): Promise<string | null> {
  if (e.needs_ticket) {
    const [t] = await tx`select 1 from tickets where user_id = ${userId} and fest_id = ${e.fest_id} and status <> 'void' limit 1`;
    if (!t) return who ? `${who} has no ticket for ${e.fest_name} — this event needs a fest ticket.` : `This event needs a ticket for ${e.fest_name}. Get one first.`;
  }
  if (!e.mixed_colleges) {
    const [u] = await tx<{ college: string | null }[]>`select college from users where id = ${userId}`;
    if (!sameCollege(u?.college, captainCollege)) {
      return who ? `${who}’s college doesn’t match the captain’s — this event is for one college per team.`
        : !u?.college?.trim() ? 'Add your college on your profile first — this event is for one college per team.'
        : 'This event allows only teams from one college, and your college doesn’t match the captain’s.';
    }
  }
  return null;
}

/** Re-check every joined member before an entry is confirmed or paid. Used by createOrder too. */
export async function checkEntryMembers(tx: Tx, regId: string): Promise<string | null> {
  const [r] = await tx<{ event_id: string; captain_college: string | null }[]>`
    select r.event_id, u.college as captain_college from event_regs r join users u on u.id = r.captain_id where r.id = ${regId}`;
  if (!r) return 'Entry not found.';
  const [e] = await tx<EvRow[]>`
    select ${EV_COLS(tx)} from events e join ticket_types tt on tt.id = e.ticket_type_id join fests f on f.id = e.fest_id where e.id = ${r.event_id}`;
  const members = await tx<{ user_id: string; name: string }[]>`
    select m.user_id, u.name from event_members m join users u on u.id = m.user_id where m.reg_id = ${regId} and m.status = 'joined'`;
  for (const m of members) {
    const p = await memberProblem(tx, e, m.user_id, r.captain_college, m.name);
    if (p) return p;
  }
  return null;
}

/**
 * "Register" (solo) / "Create team" (team). Solo free → confirmed at once (takes a slot). Solo paid → a forming entry
 * the student pays for next. Team → a forming team with the captain as member 1.
 * A forming entry the captain already has for this event is returned again (e.g. after an abandoned payment).
 */
export async function registerEntry(user: User, eventId: string, teamName: string): Promise<Result> {
  if (user.role !== 'student') return { error: 'Events are entered from a student account.' };
  try {
    return await sql.begin(async (tx) => {
      const e = await lockEvent(tx, eventId);
      if (!e) return { error: 'Event not found.' };
      const no = notOpen(e);
      if (no) return { error: no };
      const [mine] = await tx<{ id: string; status: string }[]>`
        select r.id, r.status from event_members m join event_regs r on r.id = m.reg_id
        where m.event_id = ${eventId} and m.user_id = ${user.id} and m.status = 'joined'`;
      if (mine) {
        if (mine.status === 'forming') return { ok: true as const, message: 'You already have an entry for this event.', regId: mine.id };
        return { error: ALREADY };
      }
      if (e.sold >= e.quota) return { error: 'This event is full.' };
      const solo = e.team_max <= 1;
      const name = teamName.trim().slice(0, 60);
      if (!solo && name.length < 2) return { error: 'Give your team a name.' };
      const p = await memberProblem(tx, e, user.id, user.college, null);
      if (p) return { error: p };
      const free = e.price_paise === 0 && solo;
      const [r] = await tx<{ id: string }[]>`
        insert into event_regs (event_id, fest_id, captain_id, team_name, status, confirmed_at)
        values (${eventId}, ${e.fest_id}, ${user.id}, ${solo ? null : name}, ${free ? 'confirmed' : 'forming'}, ${free ? new Date() : null})
        returning id`;
      await tx`insert into event_members (reg_id, event_id, email, user_id, status, joined_at)
               values (${r.id}, ${eventId}, ${user.email}, ${user.id}, 'joined', now())`;
      if (free) await tx`update ticket_types set sold = sold + 1 where id = ${e.ticket_type_id}`;
      return {
        ok: true as const, regId: r.id,
        message: free ? `You’re registered for ${e.title}.` : solo ? 'Entry started — pay to confirm your slot.' : `Team “${name}” created. Invite your teammates.`,
      };
    });
  } catch (err) {
    if (isUnique(err)) return { error: ALREADY };
    throw err;
  }
}

/** Captain invites a teammate by email (up to max − joined − invites outstanding). Returns the invite for the email. */
export async function inviteMember(user: User, regId: string, emailRaw: string): Promise<Result & { invite?: { email: string; event: string; fest: string } }> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: 'Enter a valid email.' };
  if (email === user.email.toLowerCase()) return { error: 'You’re already in this team.' };
  const eventId = await eventOfReg(regId);
  if (!eventId) return { error: 'Entry not found.' };
  try {
    return await sql.begin(async (tx) => {
      const e = (await lockEvent(tx, eventId))!;
      const r = await lockReg(tx, regId);
      if (!r || r.captain_id !== user.id) return { error: 'Only the team captain can invite.' };
      if (r.status !== 'forming' && r.status !== 'confirmed') return { error: 'This entry was withdrawn.' };
      if (closed(e)) return { error: 'Registration for this event has closed.' };
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from event_members where reg_id = ${regId} and status in ('joined', 'invited')`;
      if (n >= e.team_max) return { error: `A team can have at most ${e.team_max} members (invites included).` };
      const [u] = await tx<{ id: string }[]>`select id from users where email = ${email}`;
      await tx`insert into event_members (reg_id, event_id, email, user_id, status) values (${regId}, ${eventId}, ${email}, ${u?.id ?? null}, 'invited')`;
      return { ok: true as const, message: `Invite sent to ${email}.`, invite: { email, event: e.title, fest: e.fest_name } };
    });
  } catch (err) {
    if (isUnique(err)) return { error: `${email} is already invited to this team.` };
    throw err;
  }
}

/** Accept or decline an invite sent to my (confirmed) email. */
export async function respondInvite(user: User, memberId: string, accept: boolean): Promise<Result> {
  const [m] = await sql<{ reg_id: string; event_id: string }[]>`
    select reg_id, event_id from event_members where id = ${memberId} and email = ${user.email} and status = 'invited'`;
  if (!m) return { error: 'Invite not found (it may have been cancelled).' };
  if (!accept) {
    await sql`update event_members set status = 'declined' where id = ${memberId} and status = 'invited'`;
    return { ok: true, message: 'Invite declined.' };
  }
  if (user.role !== 'student') return { error: 'Events are entered from a student account.' };
  if (!user.verified) return { error: 'Confirm your email first — then accept the invite.' };
  try {
    return await sql.begin(async (tx) => {
      const e = (await lockEvent(tx, m.event_id))!;
      const r = (await lockReg(tx, m.reg_id))!;
      if (r.status !== 'forming' && r.status !== 'confirmed') return { error: 'This team’s entry was withdrawn.' };
      if (closed(e)) return { error: 'Registration for this event has closed.' };
      if (e.fest_status !== 'live') return { error: 'Registrations are not open for this fest.' };
      if ((await joinedCount(tx, r.id)) >= e.team_max) return { error: `This team is full (${e.team_max} members).` };
      const [already] = await tx`select 1 from event_members where event_id = ${m.event_id} and user_id = ${user.id} and status = 'joined'`;
      if (already) return { error: ALREADY };
      const p = await memberProblem(tx, e, user.id, r.captain_college, null);
      if (p) return { error: p };
      const up = await tx`update event_members set status = 'joined', user_id = ${user.id}, joined_at = now()
                          where id = ${memberId} and status = 'invited' returning id`;
      if (!up.length) return { error: 'Invite not found (it may have been cancelled).' };
      return { ok: true as const, message: `You joined ${r.team_name ? `“${r.team_name}”` : 'the team'} for ${e.title}.` };
    });
  } catch (err) {
    if (isUnique(err)) return { error: ALREADY };
    throw err;
  }
}

/** Shared rule for a member leaving / being removed: before the deadline, no payment running, confirmed team stays ≥ min. */
async function dropMember(tx: Tx, e: EvRow, r: RegRow, memberId: string, status: 'left' | 'removed'): Promise<Result> {
  const [m] = await tx<{ status: string; user_id: string | null }[]>`select status, user_id from event_members where id = ${memberId} and reg_id = ${r.id} for update`;
  if (!m || (m.status !== 'joined' && m.status !== 'invited')) return { error: 'Member not found.' };
  if (m.user_id === r.captain_id && m.status === 'joined') return { error: 'The captain can’t leave the team. Withdraw the entry instead.' };
  if (m.status === 'invited') {
    await tx`update event_members set status = 'removed' where id = ${memberId}`;
    return { ok: true, message: 'Invite cancelled.' };
  }
  if (closed(e)) return { error: 'Registration has closed — the team can’t change now. Ask the event head.' };
  if (await openOrder(tx, r.id) === 'pending') return { error: 'A payment for this entry is in progress — try again after it finishes.' };
  const joined = await joinedCount(tx, r.id);
  if (r.status === 'confirmed' && joined - 1 < e.team_min) return { error: `The team would drop below ${e.team_min} members. Add someone first, or withdraw the entry.` };
  await tx`update event_members set status = ${status} where id = ${memberId}`;
  return { ok: true, message: status === 'left' ? 'You left the team.' : 'Member removed.' };
}

export async function leaveTeam(user: User, regId: string): Promise<Result> {
  const eventId = await eventOfReg(regId);
  if (!eventId) return { error: 'Entry not found.' };
  return sql.begin(async (tx) => {
    const e = (await lockEvent(tx, eventId))!;
    const r = (await lockReg(tx, regId))!;
    const [m] = await tx<{ id: string }[]>`select id from event_members where reg_id = ${regId} and user_id = ${user.id} and status = 'joined'`;
    if (!m) return { error: 'You’re not in this team.' };
    return dropMember(tx, e, r, m.id, 'left');
  });
}

/** Captain removes a member or cancels an invite. */
export async function removeMember(user: User, memberId: string): Promise<Result> {
  const [m] = await sql<{ reg_id: string; event_id: string }[]>`select reg_id, event_id from event_members where id = ${memberId}`;
  if (!m) return { error: 'Member not found.' };
  return sql.begin(async (tx) => {
    const e = (await lockEvent(tx, m.event_id))!;
    const r = (await lockReg(tx, m.reg_id))!;
    if (r.captain_id !== user.id) return { error: 'Only the team captain can remove members.' };
    if (r.status !== 'forming' && r.status !== 'confirmed') return { error: 'This entry was withdrawn.' };
    return dropMember(tx, e, r, memberId, 'removed');
  });
}

/** Free team: "Submit team" — joined ≥ min, every member passes the rules, a slot is free. */
export async function submitEntry(user: User, regId: string): Promise<Result> {
  const eventId = await eventOfReg(regId);
  if (!eventId) return { error: 'Entry not found.' };
  return sql.begin(async (tx) => {
    const e = (await lockEvent(tx, eventId))!;
    const r = (await lockReg(tx, regId))!;
    if (r.captain_id !== user.id) return { error: 'Only the team captain can submit the team.' };
    if (r.status !== 'forming') return { error: r.status === 'confirmed' ? 'Your entry is already confirmed.' : 'This entry was withdrawn.' };
    if (e.price_paise > 0) return { error: 'This event has a fee — use “Pay & submit”.' };
    const no = notOpen(e);
    if (no) return { error: no };
    if ((await joinedCount(tx, regId)) < e.team_min) return { error: `Your team needs at least ${e.team_min} members.` };
    const p = await checkEntryMembers(tx, regId);
    if (p) return { error: p };
    if (e.sold >= e.quota) return { error: 'This event is full.' };
    await tx`update ticket_types set sold = sold + 1 where id = ${e.ticket_type_id}`;
    await tx`update event_regs set status = 'confirmed', confirmed_at = now() where id = ${regId}`;
    return { ok: true as const, message: `Team submitted — you’re in ${e.title}.` };
  });
}

/**
 * Withdraw a whole entry. Captain: a forming entry any time (no payment running), a confirmed FREE entry before the
 * deadline (frees the slot). Paid confirmed entries are refunded by the organizer (owner / Finance lead) only.
 * `byOrganizer` = event head / organizer removing an entry from the roster (before the deadline; never a paid one).
 */
export async function withdrawEntry(regId: string, opts: { userId?: string; byOrganizer?: { festId: string; eventId: string } }): Promise<Result> {
  const eventId = await eventOfReg(regId);
  if (!eventId || (opts.byOrganizer && opts.byOrganizer.eventId !== eventId)) return { error: 'Entry not found.' };
  return sql.begin(async (tx) => {
    const e = (await lockEvent(tx, eventId))!;
    const r = (await lockReg(tx, regId))!;
    if (opts.byOrganizer ? e.fest_id !== opts.byOrganizer.festId : r.captain_id !== opts.userId) return { error: 'Only the team captain can withdraw the entry.' };
    if (r.status !== 'forming' && r.status !== 'confirmed') return { error: 'This entry was already withdrawn.' };
    const order = await openOrder(tx, regId);
    if (order === 'pending') return { error: 'A payment for this entry is in progress — try again after it finishes.' };
    if (order === 'paid') return { error: opts.byOrganizer ? 'This entry is paid — refund it from Sales (owner or Finance lead).' : 'This entry is paid. Ask the organizer for a refund.' };
    if ((r.status === 'confirmed' || opts.byOrganizer) && closed(e)) return { error: 'Registration has closed — entries can’t be withdrawn now.' };
    if (r.status === 'confirmed') await tx`update ticket_types set sold = greatest(sold - 1, 0) where id = ${e.ticket_type_id}`;
    await tx`update event_regs set status = 'withdrawn' where id = ${regId}`;
    await tx`update event_members set status = 'left' where reg_id = ${regId} and status in ('joined', 'invited')`;
    return { ok: true as const, message: opts.byOrganizer ? 'Entry removed — the slot is free again.' : 'Entry withdrawn.' };
  });
}

/** Organizer / event head: tick a member present by hand (no ticket to scan). */
export async function markPresentManual(eventId: string, memberId: string, by: string) {
  const up = await sql<{ name: string }[]>`
    update event_members m set checked_in_at = now(), checked_in_by = ${by}
    from event_regs r, users u
    where m.id = ${memberId} and m.event_id = ${eventId} and m.status = 'joined' and m.checked_in_at is null
      and r.id = m.reg_id and r.status = 'confirmed' and u.id = m.user_id
    returning u.name`;
  return up[0]?.name ?? null;
}

/** Event counter (scanner): the ticket's owner is marked present once. Online only; not written to `scans`. */
export async function markPresentByTicket(opts: { festId: string; eventId: string; ticketId: string; scannerId: string }) {
  const [t] = await sql<{ status: string; user_id: string; holder_name: string; code: string }[]>`
    select status::text, user_id, holder_name, code from tickets where id = ${opts.ticketId} and fest_id = ${opts.festId}`;
  if (!t) return { result: 'invalid' as const, message: 'Ticket not found' };
  const who = { holder: t.holder_name, code: t.code };
  if (t.status === 'void') return { result: 'void' as const, message: 'Ticket cancelled', ...who };
  const [ev] = await sql<{ title: string }[]>`select title from events where id = ${opts.eventId} and fest_id = ${opts.festId}`;
  if (!ev) return { result: 'invalid' as const, message: 'Pick an event first' };
  const [m] = await sql<{ id: string; reg_status: string; team_name: string | null; reg_id: string }[]>`
    select m.id, r.status as reg_status, r.team_name, r.id as reg_id from event_members m join event_regs r on r.id = m.reg_id
    where m.event_id = ${opts.eventId} and m.user_id = ${t.user_id} and m.status = 'joined'`;
  if (!m) {
    const other = await sql<{ title: string }[]>`
      select e.title from event_members m join event_regs r on r.id = m.reg_id join events e on e.id = m.event_id
      where m.user_id = ${t.user_id} and e.fest_id = ${opts.festId} and m.status = 'joined' and r.status = 'confirmed' order by e.starts_at`;
    return { result: 'invalid' as const, message: `Not registered for ${ev.title}${other.length ? ` — registered for ${other.map((o) => o.title).join(', ')}` : ''}`, ...who };
  }
  if (m.reg_status !== 'confirmed') {
    const what = m.team_name ? 'Team' : 'Entry';
    return { result: 'invalid' as const, headline: `✕ ${what} not confirmed yet`, message: m.team_name ? `“${m.team_name}” hasn’t been submitted or paid` : 'Not paid yet', type: ev.title, ...who };
  }
  const up = await sql`update event_members set checked_in_at = now(), checked_in_by = ${opts.scannerId}
                       where id = ${m.id} and checked_in_at is null returning id`;
  const [c] = await sql<{ here: number; joined: number; at: Date | null }[]>`
    select (count(*) filter (where checked_in_at is not null))::int here, count(*)::int joined,
           (select checked_in_at from event_members where id = ${m.id}) at
    from event_members where reg_id = ${m.reg_id} and status = 'joined'`;
  // The event name is shown once (as `type`); a team adds its name and how many are here
  const team = m.team_name ? ` — ${m.team_name} (${c.here}/${c.joined} here)` : '';
  if (up.length) return { result: 'admitted' as const, message: `Present ✓${team}`, type: ev.title, ...who };
  return { result: 'duplicate' as const, message: `Already marked${c.at ? ` at ${time(c.at)}` : ''}${team}`, type: ev.title, ...who };
}

/** Event counter numbers: members present at this event, and of those, marked by this scanner. */
export async function eventCounts(eventId: string, scannerId: string) {
  const [c] = await sql<{ inn: number; total: number; mine: number }[]>`
    select (count(*) filter (where m.checked_in_at is not null))::int inn, count(*)::int total,
           (count(*) filter (where m.checked_in_by = ${scannerId}))::int mine
    from event_members m join event_regs r on r.id = m.reg_id
    where m.event_id = ${eventId} and m.status = 'joined' and r.status = 'confirmed'`;
  return c;
}

/**
 * Events the scanner may use at the Event counter: managers → every event of the fest; event heads → the events of
 * their active (confirmed email, today) event-head rows that have scanning switched on.
 */
export async function counterEvents(festId: string, user: Pick<User, 'id' | 'email' | 'verified'>, manager: boolean) {
  return sql<{ id: string; title: string }[]>`
    select e.id, e.title from events e where e.fest_id = ${festId}
      ${manager ? sql`` : sql`and e.id in (select r.event_id from fest_roles r where r.fest_id = ${festId} and ${activeRole(user)}
                                           and r.role = 'event_head' and r.event_id is not null and r.can_scan)`}
    order by e.starts_at, e.title`;
}

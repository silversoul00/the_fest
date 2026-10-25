import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from './auth';
import { sql } from './db';
import { isUuid } from './http';
import { todayIST } from './format';
import { permsFor, rolesLabel, type Perm, type RoleKey } from './roles';
import type { Fest, User } from './types';

/*
 * Server-side access to a fest (Team & Roles, v2.7). Every organizer page calls pageAccess, every organizer server
 * action calls requirePerm (tests/team_roles.py fails if one doesn't). Computed on every request — no caching across
 * requests — so removing a role cuts access on the next click.
 *
 * An ACTIVE role = a fest_roles row for the user's email, the user's email is confirmed, and the row has no day or
 * that day is today (IST). Any account type may hold a role (Harshith, Oct 24 2026); the owner is the fest's organizer.
 */

let ready = false;
/** Is v2.7 (fest_roles + fest_activity) in the database? Without it only the owner gets in. */
export async function rolesReady(): Promise<boolean> {
  if (ready) return true;
  const [r] = await sql<{ ok: boolean }[]>`
    select to_regclass('public.fest_roles') is not null and to_regclass('public.fest_activity') is not null as ok`;
  ready = !!r?.ok;
  return ready;
}
export const ROLES_MISSING = 'Team & Roles needs a database update (v2.7) — ask THE FEST to run it.';

let evReady = false;
/** Is v2.8 (events, event_regs, event_members, orders.registration_id) in the database? Without it Events is hidden. */
export async function eventsReady(): Promise<boolean> {
  if (evReady) return true;
  const [r] = await sql<{ ok: boolean }[]>`
    select to_regclass('public.event_members') is not null and to_regclass('public.events') is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'registration_id') as ok`;
  evReady = !!r?.ok;
  return evReady;
}
export const EVENTS_MISSING = 'Events need a database update (v2.8) — ask THE FEST to run it.';

export type OwnFest = Fest & { is_owner: boolean };
export type FestAccess = {
  fest: OwnFest; isOwner: boolean; roles: RoleKey[]; perms: Set<Perm>; label: string;
  /** v2.8: events this person is Event head / Judge of (active roles linked to an event). */
  headOf: string[]; judgeOf: string[];
};

/** SQL condition: a fest_roles row `r` is active today for this user. */
export const activeRole = (user: Pick<User, 'email' | 'verified'>, alias = 'r') =>
  sql`(${sql(alias)}.email = ${user.email} and ${user.verified} and (${sql(alias)}.scope_day is null or ${sql(alias)}.scope_day = ${todayIST()}::date))`;

async function load(festId: string, userId: string, email: string, verified: boolean): Promise<FestAccess | null> {
  if (!isUuid(festId)) return null;
  const user = { email, verified };
  const withRoles = await rolesReady();
  const [f] = await sql<(OwnFest & { roles: string[]; head_of: string[]; judge_of: string[] })[]>`
    select f.*, (f.organizer_id = ${userId}) as is_owner,
      ${withRoles
        ? sql`coalesce((select array_agg(distinct r.role) from fest_roles r where r.fest_id = f.id and ${activeRole(user)}), '{}')`
        : sql`'{}'::text[]`} as roles,
      ${withRoles
        ? sql`coalesce((select array_agg(distinct r.event_id::text) from fest_roles r where r.fest_id = f.id and r.role = 'event_head' and r.event_id is not null and ${activeRole(user)}), '{}')`
        : sql`'{}'::text[]`} as head_of,
      ${withRoles
        ? sql`coalesce((select array_agg(distinct r.event_id::text) from fest_roles r where r.fest_id = f.id and r.role = 'judge' and r.event_id is not null and ${activeRole(user)}), '{}')`
        : sql`'{}'::text[]`} as judge_of
    from fests f where f.id = ${festId}`;
  if (!f) return null;
  const roles = (f.roles ?? []) as RoleKey[];
  if (!f.is_owner && !roles.length) return null;
  const { roles: _r, head_of, judge_of, ...fest } = f;
  return {
    fest: fest as OwnFest, isOwner: f.is_owner, roles, perms: permsFor(f.is_owner, roles), label: rolesLabel(f.is_owner, roles),
    headOf: head_of ?? [], judgeOf: judge_of ?? [],
  };
}
const loadCached = cache(load);

/** This user's access to a fest, or null (not the owner, no active role). Memoised per request. */
export const festAccess = (festId: string, user: Pick<User, 'id' | 'email' | 'verified'>) =>
  loadCached(festId, user.id, user.email.toLowerCase(), !!user.verified);

/** Fest ids the user owns or holds an active role in. */
export async function myFestIds(user: Pick<User, 'id' | 'email' | 'verified'>): Promise<string[]> {
  const withRoles = await rolesReady();
  const rows = await sql<{ id: string }[]>`
    select f.id from fests f where f.organizer_id = ${user.id}
    ${withRoles ? sql`or exists (select 1 from fest_roles r where r.fest_id = f.id and ${activeRole(user)})` : sql``}`;
  return rows.map((r) => r.id);
}

/** Thrown by requirePerm when the person is on the team but their role doesn't cover the action. */
export class RoleCantDoThis extends Error { constructor() { super('Your role can’t do this.'); } }

/**
 * Every organizer server action starts with this, naming the permission it needs.
 * Unknown fest / no active role → "Fest not found" (doesn't reveal the fest); wrong role → "Your role can't do this."
 */
export async function requirePerm(fd: FormData, perm: Perm) {
  const user = await requireUser();
  const festId = String(fd.get('festId') ?? '').trim();
  const a = await festAccess(festId, user);
  if (!a) throw new Error('Fest not found');
  if (!a.perms.has(perm)) throw new RoleCantDoThis();
  return { user, fest: a.fest, access: a };
}

/**
 * Every page under /organizer/[festId] starts with this. No access → 404; on the team but the tab isn't theirs →
 * the "Your role can't open this tab" page. `perm: null` = any active role (that page itself).
 */
export async function pageAccess(festId: string, perm: Perm | null) {
  const user = await requireUser();
  const a = await festAccess(festId, user);
  if (!a) notFound();
  if (perm && !a.perms.has(perm)) redirect(`/organizer/${a.fest.id}/no-access`);
  return { user, fest: a.fest, access: a };
}

/**
 * v2.8 event scoping. 'manage' = edit details, entry list, mark present, remove an entry, export: the `events` perm
 * (owner, co-organizer) for any event of the fest, or that event's Event head. 'view' = also that event's Judge
 * (roster without emails). Anyone else on the team → "Your role can't do this."
 */
export type EventMode = 'manage' | 'view';
export function eventAllowed(a: FestAccess, eventId: string, mode: EventMode): boolean {
  if (a.perms.has('events')) return true;
  if (a.headOf.includes(eventId)) return true;
  return mode === 'view' && a.judgeOf.includes(eventId);
}

/** Server actions on one event: festId + eventId from the form; the event must belong to this fest. */
export async function requireEventPerm(fd: FormData, mode: EventMode) {
  const user = await requireUser();
  const festId = String(fd.get('festId') ?? '').trim();
  const eventId = String(fd.get('eventId') ?? '').trim();
  const a = await festAccess(festId, user);
  if (!a) throw new Error('Fest not found');
  if (!(await eventsReady())) throw new Error(EVENTS_MISSING);
  if (!isUuid(eventId)) throw new Error('Event not found');
  const [ev] = await sql<{ id: string }[]>`select id from events where id = ${eventId} and fest_id = ${a.fest.id}`;
  if (!ev) throw new Error('Event not found');
  if (!eventAllowed(a, eventId, mode)) throw new RoleCantDoThis();
  return { user, fest: a.fest, access: a, eventId };
}

/** Pages / routes for one event: unknown → 404, on the team but not this event → the "can't open this tab" page. */
export async function eventPageAccess(festId: string, eventId: string, mode: EventMode) {
  const g = await pageAccess(festId, 'events_view');
  if (!(await eventsReady()) || !isUuid(eventId)) notFound();
  const [ev] = await sql<{ id: string }[]>`select id from events where id = ${eventId} and fest_id = ${g.fest.id}`;
  if (!ev) notFound();
  if (!eventAllowed(g.access, eventId, mode)) redirect(`/organizer/${g.fest.id}/no-access`);
  return { ...g, eventId };
}

/** The actor for the activity log. */
export type Actor = { festId: string; userId: string; email: string; role: string };
export const actorOf = (x: { user: User; access: FestAccess }): Actor => ({
  festId: x.access.fest.id, userId: x.user.id, email: x.user.email,
  role: x.access.isOwner ? 'owner' : x.access.roles.join(','),
});

/**
 * Append one line to the fest's activity log (append-only; the app never edits or deletes rows — only rows older
 * than a year are cleared). Never put ticket QR secrets, bank details or statements in `detail` — ids, amounts, counts.
 * Written right after the change succeeds; a logging failure never undoes the action it records.
 */
export async function logActivity(a: Actor, action: string, summary: string, detail: Record<string, unknown> = {}) {
  try {
    if (!(await rolesReady())) return;
    await sql`insert into fest_activity (fest_id, actor_id, actor_email, actor_role, action, summary, detail)
             values (${a.festId}, ${a.userId}, ${a.email}, ${a.role || 'owner'}, ${action}, ${summary.slice(0, 300)}, ${sql.json(detail as never)})`;
    if (Math.random() < 0.01) await sql`delete from fest_activity where created_at < now() - interval '1 year'`;
  } catch (e) {
    console.error('activity log failed', e);
  }
}

/**
 * "Leave role": the person removes one of their OWN roles (any role, including co-organizer). Needs a confirmed
 * email — otherwise someone who signed up with that address first could drop a role meant for its real owner.
 */
export async function requireOwnRole(fd: FormData) {
  const user = await requireUser();
  const id = String(fd.get('id') ?? '');
  if (!isUuid(id) || !user.verified || !(await rolesReady())) throw new Error('Role not found');
  const [row] = await sql<{ id: string; fest_id: string; role: string; email: string }[]>`
    select id, fest_id, role, email::text from fest_roles where id = ${id} and email = ${user.email}`;
  if (!row) throw new Error('Role not found');
  return { user, row };
}

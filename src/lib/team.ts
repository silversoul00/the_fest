import 'server-only';
import { sql } from './db';
import { todayIST } from './format';
import { rolesReady } from './fest-access';
import { ROLE_COUNTER, firstTab, isRoleKey, permsFor, type RoleKey } from './roles';
import type { User } from './types';

export type RoleStatus = 'active' | 'pending_confirm' | 'pending_account' | 'not_today';

const statusOf = (verified: boolean | null, day: string | null, today: string): RoleStatus =>
  verified === null ? 'pending_account' : !verified ? 'pending_confirm' : day && day !== today ? 'not_today' : 'active';

export const STATUS_TEXT: Record<RoleStatus, string> = {
  active: 'Active',
  pending_confirm: 'Pending — email not confirmed',
  pending_account: 'Pending — no account yet',
  not_today: 'Not today',
};

export type TeamRow = {
  id: string; email: string; name: string; role: RoleKey; scope_label: string | null; scope_day: string | null;
  duty: string | null; can_scan: boolean; checked_in_at: Date | null; status: RoleStatus; scans: number;
};

/** Everyone on a fest's team (Team page), with each role's status. */
export async function teamOf(festId: string): Promise<TeamRow[]> {
  if (!(await rolesReady())) return [];
  const today = todayIST();
  const rows = await sql<(Omit<TeamRow, 'status'> & { verified: boolean | null; uname: string | null })[]>`
    select r.id, r.email::text, r.name, r.role, r.scope_label, r.scope_day::text, r.duty, r.can_scan, r.checked_in_at,
           u.name as uname, case when u.id is null then null else u.email_verified_at is not null end as verified,
           coalesce((select count(*) from scans s where s.fest_id = r.fest_id and s.scanned_by = u.id and s.result = 'admitted'), 0)::int as scans
    from fest_roles r left join users u on u.email = r.email
    where r.fest_id = ${festId}
    order by r.created_at, r.id`;
  return rows.filter((r) => isRoleKey(r.role)).map(({ verified, uname, ...r }) => ({
    ...r, name: r.name || uname || '', status: statusOf(verified, r.scope_day, today),
  }));
}

export type MyFestRoles = {
  festId: string; festName: string; starts_on: string; ends_on: string;
  roles: { id: string; role: RoleKey; scope_label: string | null; scope_day: string | null; status: RoleStatus }[];
  dashboard: string | null; scanner: boolean;
};

/** Roles this person holds at fests they don't own ("My fest roles" on /me and the organizer home). */
export async function myRoles(user: Pick<User, 'id' | 'email' | 'verified'>): Promise<MyFestRoles[]> {
  if (!(await rolesReady())) return [];
  const today = todayIST();
  const rows = await sql<{ id: string; fest_id: string; fest_name: string; starts_on: string; ends_on: string; role: string;
    scope_label: string | null; scope_day: string | null; can_scan: boolean }[]>`
    select r.id, r.fest_id, f.name as fest_name, f.starts_on, f.ends_on, r.role, r.scope_label, r.scope_day::text, r.can_scan
    from fest_roles r join fests f on f.id = r.fest_id
    where r.email = ${user.email} and f.organizer_id <> ${user.id} and f.status <> 'cancelled'
    order by f.starts_on, r.created_at`;
  const out = new Map<string, MyFestRoles>();
  for (const r of rows) {
    if (!isRoleKey(r.role)) continue;
    const g = out.get(r.fest_id) ?? { festId: r.fest_id, festName: r.fest_name, starts_on: r.starts_on, ends_on: r.ends_on, roles: [], dashboard: null, scanner: false };
    const status = statusOf(user.verified, r.scope_day, today);
    g.roles.push({ id: r.id, role: r.role, scope_label: r.scope_label, scope_day: r.scope_day, status });
    if (status === 'active' && (r.role === 'co_organizer' || (ROLE_COUNTER[r.role] && r.can_scan))) g.scanner = true;
    out.set(r.fest_id, g);
  }
  for (const g of out.values()) {
    const active = g.roles.filter((r) => r.status === 'active').map((r) => r.role);
    g.dashboard = active.length ? firstTab(g.festId, permsFor(false, active)) : null;
  }
  return [...out.values()];
}

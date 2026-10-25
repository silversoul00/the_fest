/*
 * Team & Roles (v2.7, Oct 2026). The ONE place that decides who may do what in a fest.
 * Fixed roles (no custom roles in v1); each role is a set of permissions; several roles → the union.
 * The owner has every permission. Pages and server actions name the permission they need
 * (src/lib/fest-access.ts: requirePerm / pageAccess) — there is no default.
 */

export const ROLE_KEYS = [
  'co_organizer', 'event_head', 'judge', 'finance', 'sponsorship', 'media', 'vol_gate', 'vol_lunch', 'vol_stay', 'desk',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABEL: Record<RoleKey, string> = {
  co_organizer: 'Co-organizer',
  event_head: 'Event head',
  judge: 'Judge',
  finance: 'Finance lead',
  sponsorship: 'Sponsorship lead',
  media: 'Media / PR',
  vol_gate: 'Gate volunteer',
  vol_lunch: 'Lunch volunteer',
  vol_stay: 'Stay volunteer',
  desk: 'Desk volunteer',
};

/** One line under each role in the "Add to team" form. */
export const ROLE_HINT: Record<RoleKey, string> = {
  co_organizer: 'Runs the fest with you (everything except refunds, adding Finance leads or co-organizers, payout UPI ID and cancelling).',
  event_head: 'Runs one event: its details, entry list, CSV and the Event scanner counter. Not its fee or slots.',
  judge: 'Sees the entry list of one event (no emails). Scoring comes later.',
  finance: 'Sales, payments, refunds, analytics and the CSV export.',
  sponsorship: 'Sponsors, brand requests and analytics.',
  media: 'Schedule, announcements and analytics.',
  vol_gate: 'Scans tickets at the gate.',
  vol_lunch: 'Scans lunch coupons only.',
  vol_stay: 'Scans stay check-in / check-out only.',
  desk: 'Looks up attendees and scans at the gate. No money.',
};

export const PERMS = [
  'overview',          // Overview tab
  'money',             // revenue / payout figures and amounts
  'fest',              // fest details, publish, ticket types, transfers (Tickets + Settings tabs)
  'sales',             // Sales list: buyers' names / emails (lookup)
  'refund',            // refunds and "UPI refund sent"
  'payments',          // confirm / reject bank-UPI orders, paste alerts, statements
  'payments_settings', // fest UPI ID, inbound email link
  'analytics',
  'export',            // CSV of every ticket
  'schedule_view',
  'schedule',          // add / delete schedule events
  'announce',
  'sponsors',          // sponsors, brand requests, open-to-brands, reports
  'team',              // add / remove roles (not co-organizers), check in volunteers, reset scanner keys
  'team_coorg',        // add / remove co-organizers
  'activity',          // activity log
  'cancel',            // cancel the fest
  'events',            // v2.8: add / edit / delete any event, see every entry list, export
  'events_view',       // v2.8: open the Events tab (event heads / judges see only their own event)
] as const;
export type Perm = (typeof PERMS)[number];

/**
 * Who may refund — Harshith, Oct 24 2026: "owner + Finance lead". Owner always has every permission.
 */
export const ROLE_PERMS: Record<RoleKey, readonly Perm[]> = {
  co_organizer: ['overview', 'money', 'fest', 'sales', 'payments', 'analytics', 'export', 'schedule_view', 'schedule', 'announce', 'sponsors', 'team', 'activity', 'events', 'events_view'],
  finance: ['overview', 'money', 'sales', 'refund', 'payments', 'analytics', 'export'],
  sponsorship: ['overview', 'analytics', 'sponsors'],
  media: ['overview', 'analytics', 'schedule_view', 'schedule', 'announce'],
  event_head: ['overview', 'schedule_view', 'events_view'],
  judge: ['events_view'],
  desk: ['sales'],
  vol_gate: [],
  vol_lunch: [],
  vol_stay: [],
};

export type Counter = 'gate' | 'lunch' | 'stay' | 'event';
/** Scanner counter each role works. Owner and co-organizers are scanner "managers" (any counter + organizer seal). */
export const ROLE_COUNTER: Partial<Record<RoleKey, Counter>> = { vol_gate: 'gate', desk: 'gate', vol_lunch: 'lunch', vol_stay: 'stay', event_head: 'event' };
export const VOLUNTEER_ROLES: readonly RoleKey[] = ['vol_gate', 'vol_lunch', 'vol_stay', 'desk'];

export const isRoleKey = (r: unknown): r is RoleKey => typeof r === 'string' && (ROLE_KEYS as readonly string[]).includes(r);

export function permsFor(isOwner: boolean, roles: readonly string[]): Set<Perm> {
  if (isOwner) return new Set(PERMS);
  const s = new Set<Perm>();
  for (const r of roles) if (isRoleKey(r)) for (const p of ROLE_PERMS[r]) s.add(p);
  return s;
}

/** Dashboard tabs, in order, and the permission each needs. */
export const TABS: { seg: string; icon: string; label: string; perm: Perm }[] = [
  { seg: '', icon: '⚡', label: 'Overview', perm: 'overview' },
  { seg: '/tickets', icon: '🎟️', label: 'Tickets', perm: 'fest' },
  { seg: '/sales', icon: '💰', label: 'Sales', perm: 'sales' },
  { seg: '/analytics', icon: '📊', label: 'Analytics', perm: 'analytics' },
  { seg: '/payments', icon: '🏦', label: 'Payments', perm: 'payments' },
  { seg: '/schedule', icon: '📅', label: 'Schedule', perm: 'schedule_view' },
  { seg: '/events', icon: '🏆', label: 'Events', perm: 'events_view' },
  { seg: '/team', icon: '👥', label: 'Team', perm: 'team' },
  { seg: '/announcements', icon: '📢', label: 'Announce', perm: 'announce' },
  { seg: '/sponsors', icon: '🏷️', label: 'Sponsors', perm: 'sponsors' },
  { seg: '/settings', icon: '⚙️', label: 'Settings', perm: 'fest' },
];

export const allowedTabs = (perms: Set<Perm>) => TABS.filter((t) => perms.has(t.perm)).map((t) => t.seg);
/** Where "Open dashboard" lands: the first tab the person may open, or null if none. */
export const firstTab = (festId: string, perms: Set<Perm>) => {
  const t = TABS.find((x) => perms.has(x.perm));
  return t ? `/organizer/${festId}${t.seg}` : null;
};

export const rolesLabel = (isOwner: boolean, roles: readonly string[]) =>
  isOwner ? 'Owner' : [...new Set(roles)].filter(isRoleKey).map((r) => ROLE_LABEL[r]).join(', ') || 'Team';

/** Name of the scanner link for someone whose counters at a fest are `counters` (managers: every counter). */
export const scannerLabel = (counters: readonly Counter[]) =>
  counters.length === 1 ? `${{ gate: 'Gate', lunch: 'Lunch', stay: 'Stay', event: 'Event' }[counters[0]]} scanner` : 'Scanner';

import 'server-only';
import { sql } from './db';

/*
 * "Is the database set up for this version of the code?"
 * Every table, and every column added later with `alter table … add column` (including ones added inside a
 * `do $$ … $$` block, like users.email_verified_at), that the code relies on.
 * Keep in step with db/schema.sql — tests/fixes1.py checks this list against that file.
 * Used by /api/health and the admin System card, so a deploy made before the production SQL was run
 * shows up as a named problem (503) instead of "ok".
 */
export const REQUIRED_TABLES = [
  // v1
  'users', 'sessions', 'fests', 'ticket_types', 'orders', 'tickets', 'scans', 'fest_staff',
  'schedule_events', 'announcements', 'sponsors', 'sponsor_visits',
  // v2
  'email_verifications', 'upi_credits', 'fest_members', 'password_resets', 'payouts', 'email_outbox',
  // v2.2 (production readiness)
  'login_attempts', 'app_errors', 'app_alert_state',
  // v2.3 (scanner counters)
  'perk_redemptions',
] as const;

export const REQUIRED_COLUMNS = [
  'users.is_admin', 'users.email_verified_at',
  'fests.upi_enabled', 'fests.upi_vpa', 'fests.upi_name', 'fests.inbound_token', 'fests.approved_at', 'fests.approved_by',
  'fests.review_note', 'fests.cancelled_reason', 'fests.allow_transfers',
  'orders.method', 'orders.gateway_fee_paise', 'orders.provider_order_id', 'orders.payment_ref', 'orders.utr',
  'orders.utr_submitted_at', 'orders.verify_source', 'orders.review_flag', 'orders.refunded_paise', 'orders.refunded_at',
  'orders.refund_note', 'orders.refund_status', 'orders.refund_retry_at', 'orders.refund_failed_paise',
  'tickets.transferred_to', 'tickets.void_reason',
  'upi_credits.fingerprint',
  'app_errors.repeats',
  'ticket_types.kind', 'ticket_types.lunch_days', 'ticket_types.includes_stay', 'orders.addon_for',
] as const;

/**
 * Names of missing tables (and table.column for missing columns of tables that do exist), in schema order.
 * Throws if the database can't be reached — callers treat that as "database down".
 */
export async function missingSchema(): Promise<string[]> {
  // Lists go in as one comma-joined string: with prepare:false (Supabase pooler) a JS array isn't typed as text[].
  const rows = await sql<{ name: string }[]>`
    select t.name from unnest(string_to_array(${REQUIRED_TABLES.join(',')}, ',')) with ordinality as t(name, n)
      where to_regclass('public.' || quote_ident(t.name)) is null
    union all
    select c.name from unnest(string_to_array(${REQUIRED_COLUMNS.join(',')}, ',')) with ordinality as c(name, n)
      where to_regclass('public.' || quote_ident(split_part(c.name, '.', 1))) is not null
        and not exists (select 1 from information_schema.columns ic
                        where ic.table_schema = 'public'
                          and ic.table_name = split_part(c.name, '.', 1)
                          and ic.column_name = split_part(c.name, '.', 2))`;
  return rows.map((r) => r.name);
}

/** The problem line shown by /api/health and the admin System card, e.g. "database setup incomplete: login_attempts". */
export const schemaProblem = (missing: string[]) => `database setup incomplete: ${missing.join(', ')}`;

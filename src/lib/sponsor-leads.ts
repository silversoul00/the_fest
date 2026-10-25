import 'server-only';
import { sql } from './db';

/** The notice students agree to at the booth. Bump when the booth wording changes. */
export const LEAD_NOTICE_VERSION = 'lead-v1';
export const BOOTH_CODE_RE = /^[A-Za-z0-9_-]{6,32}$/;
export const COURSE_MAX = 60;
export const OFFER_MAX = 120;

let ready = false;
/**
 * Is v2.5 (sponsor_leads + sponsors.lead_offer) in this database? An older database keeps working without it:
 * booth check-in and the sponsor portal still run, leads just stay switched off. Only "yes" is cached.
 */
export async function leadsReady(): Promise<boolean> {
  if (ready) return true;
  const [r] = await sql<{ ok: boolean }[]>`
    select to_regclass('public.sponsor_leads') is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'sponsors' and column_name = 'lead_offer') as ok`;
  ready = !!r?.ok;
  return ready;
}

export const LEADS_MISSING = 'Leads switch on after the v2.5 database update (db/schema.sql) is run.';

/**
 * Colleges for sponsors and reports: top `top` groups of 5 or more people; smaller groups and blanks are merged
 * into "Other" so no small group (or one person) can be singled out.
 */
export function groupColleges(rows: { college: string | null; n: number }[], top: number) {
  const big = rows.filter((r) => r.college && r.n >= 5).sort((a, b) => b.n - a.n);
  const shown = big.slice(0, top).map((r) => ({ college: r.college as string, n: r.n }));
  const keep = new Set(shown.map((r) => r.college));
  const other = rows.filter((r) => !(r.college && keep.has(r.college))).reduce((a, r) => a + r.n, 0);
  return other > 0 ? [...shown, { college: 'Other', n: other }] : shown;
}

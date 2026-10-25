import 'server-only';
import { after } from 'next/server';
import { sql } from './db';
import { adminEmails } from './auth';

/*
 * Built-in error log (free, no extra account).
 * reportError() stores the error in app_errors (shown on /admin/errors) and emails
 * ADMIN_EMAILS at most once every 15 minutes: "N new errors on THE FEST".
 * It never throws — reporting an error must not cause another one.
 *
 * Growth is capped so a broken page can't fill the free 500 MB database:
 *  • the same error (same place + same first line) within 5 minutes of the last one only bumps
 *    `repeats` and `at` (last seen) on the existing row — a page that fails on every 15-second refresh
 *    stays one row;
 *  • every 50th new row prunes rows older than 30 days and everything beyond the newest 5,000.
 */
const cut = (s: unknown, n = 1000) => String(s ?? '').slice(0, n);
export const ERROR_DEDUP_MINUTES = 5;
export const ERROR_KEEP_DAYS = 30;
export const ERROR_KEEP_ROWS = 5000;
const PRUNE_EVERY = 50;

export async function reportError(err: unknown, where: string, extra: { path?: string; digest?: string; alert?: boolean } = {}) {
  const e = err as { message?: string; stack?: string; digest?: string } | undefined;
  const message = cut(e?.stack || e?.message || err);
  const w = cut(where, 200);
  const firstLine = message.split('\n')[0];
  console.error(`[${where}]`, err);
  try {
    // One statement: bump a recent identical row, or insert a new one.
    const [row] = await sql<{ id: string; fresh: boolean }[]>`
      with hit as (
        update app_errors set repeats = repeats + 1, at = now()
        where id = (select id from app_errors
                    where where_ = ${w} and split_part(message, chr(10), 1) = ${firstLine}
                      and at > now() - make_interval(mins => ${ERROR_DEDUP_MINUTES})
                    order by at desc limit 1)
        returning id, false as fresh
      ), ins as (
        insert into app_errors (where_, message, digest, path)
        select ${w}, ${message}, ${cut(extra.digest ?? e?.digest ?? '', 200) || null}, ${cut(extra.path ?? '', 500) || null}
        where not exists (select 1 from hit)
        returning id, true as fresh
      )
      select id::text, fresh from hit union all select id::text, fresh from ins`;
    if (row?.fresh && Number(row.id) % PRUNE_EVERY === 0) await pruneErrors();
    if (extra.alert !== false) await alertAdmins();
  } catch (dbErr) {
    console.error('reportError: could not save the error', dbErr);
  }
}

/** Keep the log small: drop rows older than 30 days and anything beyond the newest 5,000. */
export async function pruneErrors() {
  await sql`
    delete from app_errors
    where at < now() - make_interval(days => ${ERROR_KEEP_DAYS})
       or id <= (select id from app_errors order by id desc offset ${ERROR_KEEP_ROWS} limit 1)`;
}

/** One alert email per 15 minutes, no matter how many errors or server instances. */
async function alertAdmins() {
  const to = adminEmails();
  if (!to.length) return;
  // Atomic claim: only the request that moves last_alert_at forward sends the email.
  const [claim] = await sql<{ prev: Date | null }[]>`
    with prev as (select last_alert_at from app_alert_state where id = 1)
    insert into app_alert_state (id, last_alert_at) values (1, now())
    on conflict (id) do update set last_alert_at = now()
      where app_alert_state.last_alert_at < now() - interval '15 minutes'
    returning (select last_alert_at from prev) as prev`;
  if (!claim) return;
  const [{ n }] = await sql<{ n: number }[]>`
    select coalesce(sum(repeats), 0)::int n from app_errors where ${claim.prev ? sql`at > ${claim.prev}` : sql`true`}`;
  const { sendEmail } = await import('./mail');
  const { siteUrlOrNull } = await import('./env');
  const site = siteUrlOrNull();
  for (const email of to) {
    await sendEmail(email, `${n} new error${n === 1 ? '' : 's'} on THE FEST`, [
      `${n} new error${n === 1 ? '' : 's'} since the last alert.`, '',
      site ? `See them: ${site}/admin/errors` : 'See them in Admin → Errors.', '',
      'You get at most one of these emails every 15 minutes.', '', '— THE FEST',
    ].join('\n'), { reportFailures: false });
  }
}

/**
 * Run work after the response is sent (emails etc.) without it being dropped on serverless:
 * Next.js after() keeps the function alive until it finishes (Vercel waitUntil).
 * Outside a request (scripts), it just runs the work now.
 */
export async function afterResponse(where: string, work: () => Promise<unknown>) {
  const run = () => work().then(() => undefined, (e) => reportError(e, where));
  try {
    after(run);
  } catch {
    await run();
  }
}

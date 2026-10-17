import 'server-only';
import { after } from 'next/server';
import { sql } from './db';
import { adminEmails } from './auth';

/*
 * Built-in error log (free, no extra account).
 * reportError() stores the error in app_errors (shown on /admin/errors) and emails
 * ADMIN_EMAILS at most once every 15 minutes: "N new errors on THE FEST".
 * It never throws — reporting an error must not cause another one.
 */
const cut = (s: unknown, n = 1000) => String(s ?? '').slice(0, n);

export async function reportError(err: unknown, where: string, extra: { path?: string; digest?: string; alert?: boolean } = {}) {
  const e = err as { message?: string; stack?: string; digest?: string } | undefined;
  const message = cut(e?.stack || e?.message || err);
  console.error(`[${where}]`, err);
  try {
    await sql`insert into app_errors (where_, message, digest, path)
              values (${cut(where, 200)}, ${message}, ${cut(extra.digest ?? e?.digest ?? '', 200) || null}, ${cut(extra.path ?? '', 500) || null})`;
    if (extra.alert !== false) await alertAdmins();
  } catch (dbErr) {
    console.error('reportError: could not save the error', dbErr);
  }
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
    select count(*)::int n from app_errors where ${claim.prev ? sql`at > ${claim.prev}` : sql`true`}`;
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

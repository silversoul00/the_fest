import { NextResponse } from 'next/server';
import { configProblems, configWarnings } from '@/lib/env';
import { missingSchema, schemaProblem } from '@/lib/schema-check';

export const dynamic = 'force-dynamic';

/*
 * Public health check for uptime monitors.
 *   200 {"status":"ok","db":"up"}                                  everything fine
 *   200 {..., "warnings":["NO_LIVE_GATEWAY"]}                       works, but worth knowing
 *   503 {"status":"misconfigured","db":"up","problems":[...]}      a required setting is missing/wrong, or
 *                                                                  "database setup incomplete: <tables>" (run the SQL)
 *   503 {"status":"down","db":"down"}                              database unreachable
 * Only setting and table NAMES are listed — never values.
 */
export async function GET() {
  const problems = configProblems();
  const warnings = configWarnings();
  let db: 'up' | 'down' = 'up';
  let reason: string | undefined;
  try {
    const missing = await missingSchema();
    if (missing.length) problems.push(schemaProblem(missing));
  } catch (e) {
    db = 'down';
    reason = dbReason(e);
  }
  const body: Record<string, unknown> = {
    status: db === 'down' ? 'down' : problems.length ? 'misconfigured' : 'ok',
    db,
  };
  if (reason) body.reason = reason;
  if (problems.length) body.problems = problems;
  if (warnings.length) body.warnings = warnings;
  return NextResponse.json(body, {
    status: body.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** A short, value-free label for why the database can't be reached (never the URL or password). */
function dbReason(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  if (code === '28P01' || /password authentication/i.test(msg)) return 'WRONG_DB_PASSWORD';
  if (/tenant or user not found/i.test(msg)) return 'WRONG_DB_USER_OR_PROJECT';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DB_HOST_NOT_FOUND';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'CONNECT_TIMEOUT') return 'DB_NOT_REACHABLE';
  if (/DATABASE_URL is not set/.test(msg)) return 'DATABASE_URL_MISSING';
  if (/Invalid URL|URIError|URI malformed/i.test(msg) || code === 'ERR_INVALID_URL') return 'DATABASE_URL_MALFORMED';
  return code && /^[A-Z0-9_]{2,30}$/.test(code) ? `DB_ERROR_${code}` : 'DB_ERROR';
}

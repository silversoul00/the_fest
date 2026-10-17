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
  try {
    const missing = await missingSchema();
    if (missing.length) problems.push(schemaProblem(missing));
  } catch {
    db = 'down';
  }
  const body: Record<string, unknown> = {
    status: db === 'down' ? 'down' : problems.length ? 'misconfigured' : 'ok',
    db,
  };
  if (problems.length) body.problems = problems;
  if (warnings.length) body.warnings = warnings;
  return NextResponse.json(body, {
    status: body.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

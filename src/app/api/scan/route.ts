import { getScanner } from '@/lib/auth';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { scannableFests } from '@/lib/queries';
import { checkIn, liveOf, markEvent, perkCounts, redeemPerk, type Counter } from '@/lib/scan';
import { counterEvents, eventCounts } from '@/lib/events';
import { dateRange } from '@/lib/format';
import { sql } from '@/lib/db';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const scanner = await getScanner();
  if (!scanner) return fail('Scanner locked — log in again.', 401);

  const b = await body<{ festId?: string; gate?: string; counter?: string; payload?: string; code?: string; eventId?: string }>(req);
  if (!b || !isUuid(b.festId)) return fail('Pick a fest first.');
  if (!b.payload && !b.code) return fail('Nothing scanned.');
  if ((b.payload?.length ?? 0) > 600 || (b.code?.length ?? 0) > 40) return fail('Not a THE FEST ticket.');

  const f = (await scannableFests(scanner)).find((x) => x.id === b.festId);
  if (!f) return fail('You are not on this fest’s gate team.', 403);
  if (!f.counters.length) return fail(`Your shift is on ${dateRange(f.shift_day!, f.shift_day!)}.`, 403);

  // Volunteers work only the counter(s) their role(s) give — a counter the browser sends is used only if it is one of
  // them. Owners and co-organizers may pick any counter.
  const counter: Counter = f.counters.includes(b.counter as Counter) ? (b.counter as Counter) : f.counters[0];

  const live = liveOf(b.payload);
  if (counter === 'event') {
    // Event heads: only their own event(s); managers: any event of this fest
    if (!isUuid(b.eventId) || !(await counterEvents(b.festId, scanner, f.manager)).some((e) => e.id === b.eventId)) {
      return fail('Pick one of your events first.', 403);
    }
    const verdict = await markEvent({ festId: b.festId, scannerId: scanner.id, eventId: b.eventId, payload: b.payload, code: b.code });
    return json({ ...verdict, counter, live, counts: await eventCounts(b.eventId, scanner.id) });
  }
  if (counter !== 'gate') {
    const verdict = await redeemPerk({ festId: b.festId, scannerId: scanner.id, counter, payload: b.payload, code: b.code });
    return json({ ...verdict, counter, live, counts: await perkCounts(b.festId, scanner.id, counter) });
  }

  const gate = (b.gate || 'Gate').slice(0, 40);
  const verdict = await checkIn({ festId: b.festId, scannerId: scanner.id, gate, payload: b.payload, code: b.code });

  const [c] = await sql<{ inn: number; total: number; mine: number }[]>`
    select (select count(*) from tickets where fest_id = ${b.festId} and status = 'used')::int inn,
           (select count(*) from tickets where fest_id = ${b.festId} and status <> 'void')::int total,
           (select count(*) from scans where fest_id = ${b.festId} and scanned_by = ${scanner.id} and result = 'admitted')::int mine`;
  return json({ ...verdict, counter, live, counts: c });
}

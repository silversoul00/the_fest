import { getScanner } from '@/lib/auth';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { scannableFests } from '@/lib/queries';
import { checkIn } from '@/lib/scan';
import { sql } from '@/lib/db';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const scanner = await getScanner();
  if (!scanner) return fail('Scanner locked — log in again.', 401);

  const b = await body<{ festId?: string; gate?: string; payload?: string; code?: string }>(req);
  if (!b || !isUuid(b.festId)) return fail('Pick a fest first.');
  if (!b.payload && !b.code) return fail('Nothing scanned.');
  if ((b.payload?.length ?? 0) > 400 || (b.code?.length ?? 0) > 40) return fail('Not a THE FEST ticket.');

  const allowed = (await scannableFests(scanner)).some((f) => f.id === b.festId);
  if (!allowed) return fail('You are not on this fest’s gate team.', 403);

  const gate = (b.gate || 'Gate').slice(0, 40);
  const verdict = await checkIn({ festId: b.festId, scannerId: scanner.id, gate, payload: b.payload, code: b.code });

  const [c] = await sql<{ inn: number; total: number; mine: number }[]>`
    select (select count(*) from tickets where fest_id = ${b.festId} and status = 'used')::int inn,
           (select count(*) from tickets where fest_id = ${b.festId} and status <> 'void')::int total,
           (select count(*) from scans where fest_id = ${b.festId} and scanned_by = ${scanner.id} and result = 'admitted')::int mine`;
  return json({ ...verdict, counts: c });
}

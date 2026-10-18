import { NextResponse } from 'next/server';
import { getScanner, scannerSessionExpiry } from '@/lib/auth';
import { isUuid } from '@/lib/http';
import { scannableFests } from '@/lib/queries';
import { counterFor } from '@/lib/scan';
import { scannerKeys } from '@/lib/qr2';
import { ROLES, type SealRole } from '@/lib/qr2-format';
import { todayIST } from '@/lib/format';

/*
 * Offline keys for THE FEST scanner: only the roles this person works at this fest
 * (volunteer: the one counter their duty says; owner / co-organizer: all five), for the current and the
 * previous key epoch, plus the public key that checks every ticket's signature.
 * Never cached, and not served after the day after the fest ends.
 */
const noStore = { 'Cache-Control': 'no-store' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

export async function GET(req: Request) {
  const scanner = await getScanner();
  if (!scanner) return fail('Scanner locked — log in again.', 401);
  const festId = new URL(req.url).searchParams.get('festId');
  if (!isUuid(festId)) return fail('Pick a fest first.', 400);
  const rows = (await scannableFests(scanner)).filter((f) => f.id === festId);
  if (!rows.length) return fail('You are not on this fest’s team.', 403);

  const f = rows[0] as (typeof rows)[number] & { qr_epoch: number };
  // Last day keys are served: the day after the fest ends (IST). They expire at the end of that day.
  const lastDay = new Date(Date.parse(`${f.ends_on}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  if (todayIST() > lastDay) return fail('This fest is over — offline keys are no longer given out.', 403);
  const keysEnd = new Date(Date.parse(`${lastDay}T00:00:00+05:30`) + 864e5);
  const session = await scannerSessionExpiry();
  const expiresAt = session && session < keysEnd ? session : keysEnd;

  const manager = rows.some((r) => r.duty === null);
  const roles: readonly SealRole[] = manager ? ROLES : [counterFor(rows[0].duty)];
  return NextResponse.json({
    festId, startsOn: f.starts_on, endsOn: f.ends_on, epoch: f.qr_epoch, expiresAt: expiresAt.toISOString(),
    ...scannerKeys(festId, roles, f.qr_epoch),
  }, { headers: noStore });
}

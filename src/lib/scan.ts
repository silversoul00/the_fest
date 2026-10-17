import 'server-only';
import { sql } from './db';
import { verifyTicket } from './ticket-crypto';
import { time, todayIST } from './format';

export type Verdict = {
  result: 'admitted' | 'duplicate' | 'invalid' | 'wrong_fest' | 'void';
  message: string;
  holder?: string;
  type?: string;
  code?: string;
  checkedInAt?: string;
  gate?: string | null;
};

/** Which desk a volunteer works: comes from their duty, set by the organizer. */
export type Counter = 'gate' | 'lunch' | 'stay';
export function counterFor(duty: string | null | undefined): Counter {
  const d = (duty ?? '').trim().toLowerCase();
  if (d.startsWith('lunch')) return 'lunch';
  if (d.startsWith('stay') || d.startsWith('hostel')) return 'stay';
  return 'gate';
}

type Resolved = { ticketId: string } | { verdict: Verdict };

/**
 * Turn a scanned QR payload (or a typed backup code) into a ticket id of this fest.
 * Failures are written to `scans` only when `logAs` (the gate name) is given.
 */
async function resolveTicket(opts: { festId: string; scannerId: string; logAs: string | null; payload?: string; code?: string }): Promise<Resolved> {
  const { festId, scannerId, logAs } = opts;
  const fail = async (ticketId: string | null, result: Verdict['result'], detail: string) => {
    if (logAs !== null) await log(festId, ticketId, scannerId, logAs, result, detail);
  };
  if (opts.payload) {
    const v = verifyTicket(opts.payload);
    if (!v.ok) {
      const message = v.reason === 'signature' ? 'Fake or tampered ticket' : 'Not a THE FEST ticket';
      await fail(null, 'invalid', message);
      return { verdict: { result: 'invalid', message } };
    }
    if (v.festId !== festId) {
      await fail(null, 'wrong_fest', 'Ticket is for another fest');
      const [f] = await sql<{ name: string }[]>`select name from fests where id = ${v.festId}`;
      return { verdict: { result: 'wrong_fest', message: f ? `This ticket is for ${f.name}` : 'Ticket is for another fest' } };
    }
    return { ticketId: v.ticketId };
  }
  if (opts.code) {
    const code = opts.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pretty = code.length === 10 && code.startsWith('TF') ? `TF-${code.slice(2, 6)}-${code.slice(6)}` : opts.code.trim().toUpperCase();
    const [t] = await sql<{ id: string; fest_id: string }[]>`select id, fest_id from tickets where code = ${pretty}`;
    if (!t) {
      await fail(null, 'invalid', `Unknown code ${pretty.slice(0, 20)}`);
      return { verdict: { result: 'invalid', message: 'No ticket with that code' } };
    }
    if (t.fest_id !== festId) {
      await fail(null, 'wrong_fest', 'Ticket is for another fest');
      return { verdict: { result: 'wrong_fest', message: 'This ticket is for another fest' } };
    }
    return { ticketId: t.id };
  }
  return { verdict: { result: 'invalid', message: 'Nothing scanned' } };
}

/**
 * Validate a scanned QR payload (or a typed backup code) and check the
 * ticket in. The UPDATE … WHERE status = 'valid' is atomic, so two gates
 * scanning the same ticket at the same instant can never both admit it.
 */
export async function checkIn(opts: { festId: string; scannerId: string; gate: string; payload?: string; code?: string }): Promise<Verdict> {
  const { festId, scannerId, gate } = opts;
  const r = await resolveTicket({ festId, scannerId, logAs: gate, payload: opts.payload, code: opts.code });
  if ('verdict' in r) return r.verdict;
  const ticketId = r.ticketId;

  // Atomic admit
  const admitted = await sql<{ holder_name: string; code: string; type: string }[]>`
    update tickets t set status = 'used', checked_in_at = now(), checked_in_by = ${scannerId}, gate = ${gate}
    from ticket_types tt
    where t.id = ${ticketId} and t.fest_id = ${festId} and t.status = 'valid' and tt.id = t.ticket_type_id
    returning t.holder_name, t.code, tt.name as type`;

  if (admitted.length) {
    await log(festId, ticketId, scannerId, gate, 'admitted', null);
    const a = admitted[0];
    return { result: 'admitted', message: 'Welcome in!', holder: a.holder_name, type: a.type, code: a.code };
  }

  // Not admitted — explain why
  const [t] = await sql<{ status: string; holder_name: string; code: string; checked_in_at: Date | null; gate: string | null; type: string }[]>`
    select t.status, t.holder_name, t.code, t.checked_in_at, t.gate, tt.name as type
    from tickets t join ticket_types tt on tt.id = t.ticket_type_id where t.id = ${ticketId}`;
  if (!t) {
    await log(festId, null, scannerId, gate, 'invalid', 'Ticket not found');
    return { result: 'invalid', message: 'Ticket not found' };
  }
  if (t.status === 'void') {
    await log(festId, ticketId, scannerId, gate, 'void', 'Cancelled ticket');
    return { result: 'void', message: 'This ticket was cancelled', holder: t.holder_name, type: t.type, code: t.code };
  }
  await log(festId, ticketId, scannerId, gate, 'duplicate', `Already used at ${t.gate ?? 'a gate'}`);
  return {
    result: 'duplicate', message: 'Already checked in', holder: t.holder_name, type: t.type, code: t.code,
    checkedInAt: t.checked_in_at?.toISOString(), gate: t.gate,
  };
}

async function log(festId: string, ticketId: string | null, by: string, gate: string, result: Verdict['result'], detail: string | null) {
  await sql`insert into scans (fest_id, ticket_id, scanned_by, gate, result, detail)
            values (${festId}, ${ticketId}, ${by}, ${gate}, ${result}, ${detail})`;
}

/*
 * Lunch / stay counters. Same QR as the gate; what the ticket gets lives in the database:
 * the ticket's own type plus every PAID add-on order attached to it (orders.addon_for).
 * Each lunch day, the stay check-in and the stay check-out is one row in perk_redemptions,
 * unique per ticket — so parallel scans can use it only once. Not written to `scans`
 * (gate and sponsor numbers read that table).
 */
const STAY_OUT_AFTER_SECONDS = 10; // a QR still in front of the camera must not check out straight after checking in

export async function redeemPerk(opts: { festId: string; scannerId: string; counter: 'lunch' | 'stay'; payload?: string; code?: string }): Promise<Verdict> {
  const { festId, scannerId, counter } = opts;
  const r = await resolveTicket({ festId, scannerId, logAs: null, payload: opts.payload, code: opts.code });
  if ('verdict' in r) return r.verdict;
  const ticketId = r.ticketId;

  const [t] = await sql<{ status: string; holder_name: string; code: string; type: string; days: string; stay: boolean }[]>`
    with p as (
      select tt.lunch_days, tt.includes_stay from tickets t join ticket_types tt on tt.id = t.ticket_type_id where t.id = ${ticketId}
      union all
      select tt.lunch_days, tt.includes_stay from orders o join ticket_types tt on tt.id = o.ticket_type_id
      where o.addon_for = ${ticketId} and o.status = 'paid'
    )
    select t.status, t.holder_name, t.code, tt.name as type,
           coalesce((select string_agg(distinct d::text, ',') from p, unnest(p.lunch_days) d), '') as days,
           coalesce((select bool_or(includes_stay) from p), false) as stay
    from tickets t join ticket_types tt on tt.id = t.ticket_type_id where t.id = ${ticketId} and t.fest_id = ${festId}`;
  if (!t) return { result: 'invalid', message: 'Ticket not found' };
  const who = { holder: t.holder_name, type: t.type, code: t.code };
  if (t.status === 'void') return { result: 'void', message: 'This ticket was cancelled', ...who };

  const claim = (slot: string) => sql<{ created_at: Date }[]>`
    insert into perk_redemptions (fest_id, ticket_id, slot, scanned_by) values (${festId}, ${ticketId}, ${slot}, ${scannerId})
    on conflict (ticket_id, slot) do nothing returning created_at`;
  const usedAt = async (slot: string) =>
    (await sql<{ created_at: Date }[]>`select created_at from perk_redemptions where ticket_id = ${ticketId} and slot = ${slot}`)[0]?.created_at;

  if (counter === 'lunch') {
    const days = t.days ? t.days.split(',').sort() : [];
    const today = todayIST();
    if (!days.length) return { result: 'invalid', message: 'No lunch on this ticket', ...who };
    if (!days.includes(today)) return { result: 'invalid', message: 'No lunch on this ticket today', ...who };
    const label = `day ${days.indexOf(today) + 1} of ${days.length}`;
    if ((await claim(`lunch:${today}`)).length) return { result: 'admitted', message: `Lunch ✓ (${label})`, ...who };
    const at = await usedAt(`lunch:${today}`);
    return { result: 'duplicate', message: `Lunch already taken today${at ? ` at ${time(at)}` : ''}`, ...who };
  }

  if (!t.stay) return { result: 'invalid', message: 'No stay on this ticket', ...who };
  if ((await claim('stay_in')).length) return { result: 'admitted', message: 'Stay: checked in', ...who };
  const inAt = await usedAt('stay_in');
  if (inAt && Date.now() - inAt.getTime() < STAY_OUT_AFTER_SECONDS * 1000) {
    return { result: 'duplicate', message: `Stay: checked in just now (${time(inAt)})`, ...who };
  }
  if ((await claim('stay_out')).length) return { result: 'admitted', message: 'Stay: checked out', ...who };
  const outAt = await usedAt('stay_out');
  return { result: 'duplicate', message: `Already checked out${outAt ? ` at ${time(outAt)}` : ''}`, ...who };
}

/** Scanner header numbers for a lunch/stay desk: today's uses at this fest, and by this volunteer. */
export async function perkCounts(festId: string, scannerId: string, counter: 'lunch' | 'stay') {
  const [c] = await sql<{ inn: number; mine: number }[]>`
    select count(*)::int inn, (count(*) filter (where scanned_by = ${scannerId}))::int mine
    from perk_redemptions
    where fest_id = ${festId}
      and (created_at at time zone 'Asia/Kolkata')::date = ${todayIST()}::date
      and ${counter === 'lunch' ? sql`slot like 'lunch:%'` : sql`slot in ('stay_in', 'stay_out')`}`;
  return { inn: c.inn, total: 0, mine: c.mine };
}

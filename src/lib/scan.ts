import 'server-only';
import { sql } from './db';
import { verifyTicket } from './ticket-crypto';

export type Verdict = {
  result: 'admitted' | 'duplicate' | 'invalid' | 'wrong_fest' | 'void';
  message: string;
  holder?: string;
  type?: string;
  code?: string;
  checkedInAt?: string;
  gate?: string | null;
};

/**
 * Validate a scanned QR payload (or a typed backup code) and check the
 * ticket in. The UPDATE … WHERE status = 'valid' is atomic, so two gates
 * scanning the same ticket at the same instant can never both admit it.
 */
export async function checkIn(opts: { festId: string; scannerId: string; gate: string; payload?: string; code?: string }): Promise<Verdict> {
  const { festId, scannerId, gate } = opts;
  let ticketId: string | null = null;

  if (opts.payload) {
    const v = verifyTicket(opts.payload);
    if (!v.ok) {
      const message = v.reason === 'signature' ? 'Fake or tampered ticket' : 'Not a THE FEST ticket';
      await log(festId, null, scannerId, gate, 'invalid', message);
      return { result: 'invalid', message };
    }
    if (v.festId !== festId) {
      await log(festId, null, scannerId, gate, 'wrong_fest', 'Ticket is for another fest');
      const [f] = await sql<{ name: string }[]>`select name from fests where id = ${v.festId}`;
      return { result: 'wrong_fest', message: f ? `This ticket is for ${f.name}` : 'Ticket is for another fest' };
    }
    ticketId = v.ticketId;
  } else if (opts.code) {
    const code = opts.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pretty = code.length === 10 && code.startsWith('TF') ? `TF-${code.slice(2, 6)}-${code.slice(6)}` : opts.code.trim().toUpperCase();
    const [t] = await sql<{ id: string; fest_id: string }[]>`select id, fest_id from tickets where code = ${pretty}`;
    if (!t) {
      await log(festId, null, scannerId, gate, 'invalid', `Unknown code ${pretty.slice(0, 20)}`);
      return { result: 'invalid', message: 'No ticket with that code' };
    }
    if (t.fest_id !== festId) {
      await log(festId, null, scannerId, gate, 'wrong_fest', 'Ticket is for another fest');
      return { result: 'wrong_fest', message: 'This ticket is for another fest' };
    }
    ticketId = t.id;
  } else {
    return { result: 'invalid', message: 'Nothing scanned' };
  }

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

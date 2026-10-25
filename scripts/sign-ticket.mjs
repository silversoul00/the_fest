// Dev helper: prints the signed QR payload for a ticket (for testing scanners).
// Usage: node scripts/sign-ticket.mjs <ticketId> <festId>                                   (old TF1 payload)
//        node --conditions=react-server scripts/sign-ticket.mjs --tf2 <ticketId> [--live|--old]   (Smart QR link, from the database;
//        --live adds the current 30-second live code, --old one from 2 minutes ago, like an old screenshot)
import { createPrivateKey, sign } from 'node:crypto';
import { loadEnv } from './env.mjs';

loadEnv();
const args = process.argv.slice(2);
if (args[0] === '--tf2') {
  const ticketId = args[1];
  if (!ticketId) { console.error('Usage: node --conditions=react-server scripts/sign-ticket.mjs --tf2 <ticketId> [--live]'); process.exit(1); }
  const { default: postgres } = await import('postgres');
  const { sealTicket, ticketSealData, liveSecret, liveCode } = await import('../src/lib/qr2.ts');
  const { b64u, liveStep } = await import('../src/lib/qr2-format.ts');
  const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {}, types: { date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x } } });
  const data = await ticketSealData(sql, ticketId);
  await sql.end();
  if (!data) { console.error('Ticket not found'); process.exit(1); }
  const { url } = sealTicket(process.env.NEXT_PUBLIC_SITE_URL || 'https://thefest.in', data);
  const step = liveStep(Date.now()) + (args.includes('--old') ? -4 : 0);
  console.log(args.includes('--live') || args.includes('--old') ? `${url}.${b64u(new Uint8Array(liveCode(liveSecret(ticketId), step)))}` : url);
  process.exit(0);
}
const [ticketId, festId] = args;
if (!ticketId || !festId) { console.error('Usage: node scripts/sign-ticket.mjs <ticketId> <festId>'); process.exit(1); }
const b = (u) => Buffer.from(u.replace(/-/g, ''), 'hex').toString('base64url');
const body = `TF1.${b(ticketId)}.${b(festId)}`;
const key = createPrivateKey(process.env.TICKET_PRIVATE_KEY.replace(/\\n/g, '\n'));
console.log(`${body}.${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`);

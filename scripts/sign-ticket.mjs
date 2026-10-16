// Dev helper: prints the signed QR payload for a ticket (for testing scanners).
// Usage: node scripts/sign-ticket.mjs <ticketId> <festId>
import { createPrivateKey, sign } from 'node:crypto';
import { loadEnv } from './env.mjs';

loadEnv();
const [ticketId, festId] = process.argv.slice(2);
if (!ticketId || !festId) { console.error('Usage: node scripts/sign-ticket.mjs <ticketId> <festId>'); process.exit(1); }
const b = (u) => Buffer.from(u.replace(/-/g, ''), 'hex').toString('base64url');
const body = `TF1.${b(ticketId)}.${b(festId)}`;
const key = createPrivateKey(process.env.TICKET_PRIVATE_KEY.replace(/\\n/g, '\n'));
console.log(`${body}.${sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`);

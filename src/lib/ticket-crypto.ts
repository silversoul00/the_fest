import 'server-only';
import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';

/*
 * Ticket QR payload:   TF1.<ticketId>.<festId>.<signature>
 *   ticketId / festId : UUIDs packed to 16 bytes → base64url (22 chars each)
 *   signature         : ECDSA P-256 / SHA-256 over "TF1.<ticketId>.<festId>",
 *                       IEEE-P1363 encoding (64 bytes) → base64url (86 chars)
 * Total ≈ 137 chars — a small, fast-scanning QR. Anyone can read the IDs,
 * but nobody without the private key can mint a ticket that verifies.
 */

const PREFIX = 'TF1';

function pem(v: string | undefined, name: string) {
  if (!v?.trim()) throw new Error(`${name} is not set. Open /setup/keys (or run "npm run keys") and add it to your env.`);
  return v.replace(/\\n/g, '\n');
}

let priv: KeyObject | null = null;
let pub: KeyObject | null = null;
const privateKey = () => (priv ??= createPrivateKey(pem(process.env.TICKET_PRIVATE_KEY, 'TICKET_PRIVATE_KEY')));
const publicKey = () =>
  (pub ??= process.env.TICKET_PUBLIC_KEY
    ? createPublicKey(pem(process.env.TICKET_PUBLIC_KEY, 'TICKET_PUBLIC_KEY'))
    : createPublicKey(privateKey()));

/**
 * Are the signing keys usable? Signs a fixed string and verifies it with the public key,
 * so a public key from a different pair is caught before any ticket is sold.
 */
export function checkTicketKeys(): 'ok' | 'missing' | 'invalid' | 'public_invalid' | 'mismatch' {
  const privRaw = (process.env.TICKET_PRIVATE_KEY ?? '').trim();
  if (!privRaw) return 'missing';
  let k: KeyObject, p: KeyObject;
  try { k = createPrivateKey(privRaw.replace(/\\n/g, '\n')); } catch { return 'invalid'; }
  if (k.asymmetricKeyType !== 'ec') return 'invalid';
  const pubRaw = (process.env.TICKET_PUBLIC_KEY ?? '').trim();
  try { p = pubRaw ? createPublicKey(pubRaw.replace(/\\n/g, '\n')) : createPublicKey(k); } catch { return 'public_invalid'; }
  try {
    const msg = Buffer.from('THE FEST key check');
    const sig = sign('sha256', msg, { key: k, dsaEncoding: 'ieee-p1363' });
    return verify('sha256', msg, { key: p, dsaEncoding: 'ieee-p1363' }, sig) ? 'ok' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

const uuidToB64 =(u: string) => Buffer.from(u.replace(/-/g, ''), 'hex').toString('base64url');
function b64ToUuid(b: string): string | null {
  const buf = Buffer.from(b, 'base64url');
  if (buf.length !== 16) return null;
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function signTicket(ticketId: string, festId: string): string {
  const body = `${PREFIX}.${uuidToB64(ticketId)}.${uuidToB64(festId)}`;
  const sig = sign('sha256', Buffer.from(body), { key: privateKey(), dsaEncoding: 'ieee-p1363' });
  return `${body}.${sig.toString('base64url')}`;
}

export type VerifyResult =
  | { ok: true; ticketId: string; festId: string }
  | { ok: false; reason: 'format' | 'signature' };

export function verifyTicket(payload: string): VerifyResult {
  const parts = payload.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return { ok: false, reason: 'format' };
  const [, t, f, s] = parts;
  const ticketId = b64ToUuid(t);
  const festId = b64ToUuid(f);
  if (!ticketId || !festId) return { ok: false, reason: 'format' };
  let good = false;
  try {
    good = verify('sha256', Buffer.from(`${PREFIX}.${t}.${f}`), { key: publicKey(), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  } catch {
    good = false;
  }
  return good ? { ok: true, ticketId, festId } : { ok: false, reason: 'signature' };
}

// Human-friendly backup code printed under the QR, e.g. TF-7K2M-QX9P.
// Crockford-style alphabet: no 0/O, 1/I/L confusion at the gate.
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function ticketCode(): string {
  const b = randomBytes(8);
  const c = Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
  return `TF-${c.slice(0, 4)}-${c.slice(4)}`;
}

export function boothCode(): string {
  return randomBytes(9).toString('base64url');
}

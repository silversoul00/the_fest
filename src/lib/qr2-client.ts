/*
 * Smart QR on THE FEST scanner (and the ticket screen's live code): WebCrypto only, works offline.
 * The scanner verifies the ECDSA signature first, then opens only the sections it holds keys for.
 */
import {
  LIVE_WINDOW, ROLE_ID, ROLES, decGate, decLunch, decOrg, decStay, isTf2Text, liveStep, parseF, parseP,
  signedMessage, splitTf2, stepBytes, unb64u, utf8, bytesUuid,
  type SealRole,
} from './qr2-format.ts';

export type KeysJson = {
  festId: string; startsOn: string; endsOn: string; epoch: number; expiresAt: string;
  roles: SealRole[]; keys: { role: SealRole; epoch: number; k: string }[]; publicKey: JsonWebKey;
};
export type Bundle = {
  festId: string; startsOn: string; endsOn: string; epoch: number; expiresAt: number;
  roles: SealRole[]; keys: Record<string, CryptoKey>; pub: CryptoKey;
};
export type LiveState = 'live' | 'stale' | 'static';
export type Opened =
  | { kind: 'other' }
  | { kind: 'tampered' }
  | { kind: 'wrong_fest' }
  | { kind: 'needs_network'; ticketId: string }
  | { kind: 'tf1'; ticketId: string }
  | {
      kind: 'ok'; ticketId: string; epoch: number; live: LiveState | null;
      gate?: { name: string; type: string }; lunch?: number; stay?: boolean; org?: string;
    };

const subtle = () => globalThis.crypto.subtle;
const buf = (b: Uint8Array) => b as unknown as BufferSource;

/** Import the keys from /api/scan/keys as non-extractable CryptoKeys (safe to keep in IndexedDB). */
export async function importBundle(j: KeysJson): Promise<Bundle> {
  const keys: Record<string, CryptoKey> = {};
  for (const k of j.keys) {
    keys[`${k.role}:${k.epoch}`] = await subtle().importKey('raw', buf(unb64u(k.k)!), { name: 'AES-GCM' }, false, ['decrypt']);
  }
  const pub = await subtle().importKey('jwk', j.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return { festId: j.festId, startsOn: j.startsOn, endsOn: j.endsOn, epoch: j.epoch, expiresAt: Date.parse(j.expiresAt), roles: j.roles, keys, pub };
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, buf(data)));
}
/** The 4-byte live code for a 30-second step (ticket screen draws it, scanner checks it). */
export const liveCode = async (secret: Uint8Array, step: number) => (await hmac(secret, stepBytes(step))).slice(0, 4);

const verifySig = (pub: CryptoKey, sig: Uint8Array, msg: Uint8Array) =>
  subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, buf(sig), buf(msg)).catch(() => false);

/** Read a scanned text with this phone's keys. Nothing here talks to the network. */
export async function openTicket(text: string, b: Bundle, nowMs = Date.now()): Promise<Opened> {
  const t = text.trim();
  if (t.startsWith('TF1.')) {
    const parts = t.split('.');
    const tid = parts.length === 4 ? unb64u(parts[1]) : null, fid = parts.length === 4 ? unb64u(parts[2]) : null;
    const sig = parts.length === 4 ? unb64u(parts[3]) : null;
    if (!tid || !fid || !sig || tid.length !== 16 || fid.length !== 16) return { kind: 'other' };
    if (!(await verifySig(b.pub, sig, utf8(`TF1.${parts[1]}.${parts[2]}`)))) return { kind: 'tampered' };
    return bytesUuid(fid) === b.festId ? { kind: 'tf1', ticketId: bytesUuid(tid) } : { kind: 'wrong_fest' };
  }
  if (!isTf2Text(t)) return { kind: 'other' };
  const parts = splitTf2(t);
  const p = parts && unb64u(parts.p), f = parts?.f ? unb64u(parts.f) : null;
  const pp = p && parseP(p), ff = f && parseF(f);
  if (!p || !pp || !ff) return { kind: 'tampered' };
  if (!(await verifySig(b.pub, ff.sig, signedMessage(p, ff.nonce, ff.body)))) return { kind: 'tampered' };
  if (!b.roles.some((r) => b.keys[`${r}:${pp.epoch}`])) return { kind: 'needs_network', ticketId: pp.ticketId };

  const out: Extract<Opened, { kind: 'ok' }> = { kind: 'ok', ticketId: pp.ticketId, epoch: pp.epoch, live: null };
  let secret: Uint8Array | null = null;
  for (const role of ROLES) {
    const key = b.roles.includes(role) ? b.keys[`${role}:${pp.epoch}`] : undefined;
    const s = key && ff.sections.find((x) => x.role === ROLE_ID[role]);
    if (!key || !s) continue;
    let plain: Uint8Array;
    try {
      plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(ff.nonce), additionalData: buf(p), tagLength: 32 }, key, buf(s.ct)));
    } catch {
      return { kind: 'wrong_fest' }; // a key of this fest doesn't fit: the ticket was sealed for another fest
    }
    if (role === 'gate') { const g = decGate(plain); if (g) { out.gate = { name: g.name, type: g.type }; secret = g.liveSecret; } }
    if (role === 'lunch') out.lunch = decLunch(plain);
    if (role === 'stay') out.stay = decStay(plain);
    if (role === 'org') { const o = decOrg(plain); if (o) out.org = o; }
  }
  if (secret) {
    if (parts!.l === null) out.live = 'static';
    else {
      const l = unb64u(parts!.l), step = liveStep(nowMs);
      let ok = false;
      if (l && l.length === 4) {
        for (const d of LIVE_WINDOW) {
          const c = await liveCode(secret, step + d);
          if (c.every((x, i) => x === l[i])) { ok = true; break; }
        }
      }
      out.live = ok ? 'live' : 'stale';
    }
  }
  return out;
}


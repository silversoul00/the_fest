import 'server-only';
import { createCipheriv, createHmac, hkdfSync, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto';
import type postgres from 'postgres';
import { privateKey, publicKey } from './ticket-crypto.ts';
import {
  LIVE_WINDOW, NONCE_LEN, ROLES, ROLE_ID, TAG_LEN, encGate, encLunch, encOrg, encStay, liveStep, packP,
  packSections, parseF, parseP, signedMessage, splitTf2, stepBytes, tf2Url, unb64u, uuidBytes,
  type Section, type SealRole,
} from './qr2-format.ts';

/*
 * Smart QR keys (no new env var, no key table):
 *   master    = HKDF-SHA256(TICKET_PRIVATE_KEY's private scalar, info "tf2-master")   (or QR_SEAL_MASTER if set)
 *   role key  = HKDF(master, salt = festId, info "seal|<role>|<epoch>")  → AES-256-GCM, one per fest + role + epoch
 *   path key  = HKDF(master, info "path")  → pathTag = HMAC(path key, ticketId · epoch)[0..6]
 *   liveSecret= HMAC(master, "live" · ticketId)[0..8]  → live code = HMAC(liveSecret, 30-second step)[0..4]
 * The ECDSA ticket key signs every QR, so a volunteer who holds a role key still can't forge or edit sections.
 */

let master: Buffer | null = null;
function masterKey(): Buffer {
  if (master) return master;
  const override = process.env.QR_SEAL_MASTER?.trim();
  const ikm = override ? Buffer.from(override, 'utf8') : Buffer.from(privateKey().export({ format: 'jwk' }).d as string, 'base64url');
  return (master = Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), 'tf2-master', 32)));
}

export const roleKey = (festId: string, role: SealRole, epoch: number) =>
  Buffer.from(hkdfSync('sha256', masterKey(), uuidBytes(festId), `seal|${role}|${epoch & 255}`, 32));
const pathKey = () => Buffer.from(hkdfSync('sha256', masterKey(), Buffer.alloc(0), 'path', 32));
export const pathTag = (ticketId: string, epoch: number) =>
  createHmac('sha256', pathKey()).update(uuidBytes(ticketId)).update(Uint8Array.of(epoch & 255)).digest().subarray(0, 6);
export const liveSecret = (ticketId: string) =>
  createHmac('sha256', masterKey()).update('live').update(uuidBytes(ticketId)).digest().subarray(0, 8);
export const liveCode = (secret: Uint8Array, step: number) => createHmac('sha256', secret).update(stepBytes(step)).digest().subarray(0, 4);

/** Epochs 1…255 go round in a circle; the one before 1 is 255. */
export const prevEpoch = (e: number) => ((e + 253) % 255) + 1;

export type TicketSeal = {
  ticketId: string; festId: string; epoch: number;
  name: string; type: string; startsOn: string; endsOn: string; lunchDays: string[]; stay: boolean;
  holderPhone: string | null;
};

function seal(key: Buffer, nonce: Buffer, aad: Uint8Array, plain: Uint8Array): Uint8Array {
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  c.setAAD(aad);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

/** Build the TF2 URL for a ticket (fresh nonce every call) and the liveSecret the ticket screen needs. */
export function sealTicket(site: string, t: TicketSeal): { url: string; liveSecret: string } {
  const secret = liveSecret(t.ticketId);
  const p = packP(t.ticketId, t.epoch, pathTag(t.ticketId, t.epoch));
  const nonce = randomBytes(NONCE_LEN);
  const plain: [SealRole, Uint8Array][] = [
    ['gate', encGate({ liveSecret: secret, name: t.name, type: t.type })],
    ['lunch', encLunch(t.startsOn, t.endsOn, t.lunchDays)],
    ['stay', encStay(t.stay)],
  ];
  const phone = (t.holderPhone ?? '').replace(/\D/g, '');
  if (phone.length >= 10) plain.push(['org', encOrg(phone)]);
  const sections: Section[] = plain.map(([role, data]) => ({ role: ROLE_ID[role], ct: seal(roleKey(t.festId, role, t.epoch), nonce, p, data) }));
  const body = packSections(sections);
  const sig = sign('sha256', signedMessage(p, nonce, body), { key: privateKey(), dsaEncoding: 'ieee-p1363' });
  return { url: tf2Url(site, p, Buffer.concat([nonce, body, sig])), liveSecret: Buffer.from(secret).toString('base64url') };
}

/** Public page: the P part alone. Null for anything that isn't a real ticket's P (wrong length, version or pathTag). */
export function openPublic(pStr: string): { ticketId: string; epoch: number } | null {
  const bytes = unb64u(pStr);
  const p = bytes && parseP(bytes);
  if (!p) return null;
  const want = pathTag(p.ticketId, p.epoch);
  return timingSafeEqual(Buffer.from(p.pathTag), want) ? { ticketId: p.ticketId, epoch: p.epoch } : null;
}

export type Live = 'live' | 'stale' | 'static';
export type Tf2Result = { ok: true; ticketId: string; epoch: number; live: Live } | { ok: false; reason: 'signature' };

/** Full check of a scanned TF2 text: signature over P + sealed part, then pathTag, then the live code. */
export function verifyTf2(text: string, nowMs = Date.now()): Tf2Result {
  const parts = splitTf2(text);
  const p = parts && unb64u(parts.p);
  const f = parts?.f ? unb64u(parts.f) : null;
  const pp = p && parseP(p);
  const ff = f && parseF(f);
  if (!p || !pp || !ff) return { ok: false, reason: 'signature' };
  let good = false;
  try {
    good = verify('sha256', signedMessage(p, ff.nonce, ff.body), { key: publicKey(), dsaEncoding: 'ieee-p1363' }, ff.sig);
  } catch { good = false; }
  if (!good || !timingSafeEqual(Buffer.from(pp.pathTag), pathTag(pp.ticketId, pp.epoch))) return { ok: false, reason: 'signature' };
  let live: Live = 'static';
  if (parts!.l !== null) {
    const l = unb64u(parts!.l);
    const secret = liveSecret(pp.ticketId), step = liveStep(nowMs);
    live = l && l.length === 4 && LIVE_WINDOW.some((d) => timingSafeEqual(liveCode(secret, step + d), l)) ? 'live' : 'stale';
  }
  return { ok: true, ticketId: pp.ticketId, epoch: pp.epoch, live };
}

/** The scanner phone's key bundle for one fest: only the roles this person works, current + previous epoch. */
export function scannerKeys(festId: string, roles: readonly SealRole[], epoch: number) {
  const epochs = [epoch & 255, prevEpoch(epoch & 255)];
  return {
    roles: ROLES.filter((r) => roles.includes(r)),
    keys: roles.flatMap((role) => epochs.map((e) => ({ role, epoch: e, k: roleKey(festId, role, e).toString('base64url') }))),
    publicKey: publicKey().export({ format: 'jwk' }),
  };
}

/** Everything sealed into a ticket's QR, read fresh from the database (so new add-ons show on the next open). */
export async function ticketSealData(sql: postgres.Sql, ticketId: string): Promise<TicketSeal | null> {
  const [r] = await sql<{
    id: string; fest_id: string; holder_name: string; type_name: string; starts_on: string; ends_on: string; qr_epoch: number;
    phone: string | null;
    days: string; stay: boolean;
  }[]>`
    with p as (
      select tt.lunch_days, tt.includes_stay from tickets t join ticket_types tt on tt.id = t.ticket_type_id where t.id = ${ticketId}
      union all
      select tt.lunch_days, tt.includes_stay from orders o join ticket_types tt on tt.id = o.ticket_type_id
      where o.addon_for = ${ticketId} and o.status = 'paid'
    )
    select t.id, t.fest_id, t.holder_name, tt.name as type_name, f.starts_on, f.ends_on, f.qr_epoch, u.phone,
           coalesce((select string_agg(distinct d::text, ',') from p, unnest(p.lunch_days) d), '') as days,
           coalesce((select bool_or(includes_stay) from p), false) as stay
    from tickets t join ticket_types tt on tt.id = t.ticket_type_id join fests f on f.id = t.fest_id
      join users u on u.id = t.user_id
    where t.id = ${ticketId}`;
  if (!r) return null;
  return {
    ticketId: r.id, festId: r.fest_id, epoch: r.qr_epoch, name: r.holder_name, type: r.type_name,
    startsOn: r.starts_on, endsOn: r.ends_on, lunchDays: r.days ? r.days.split(',') : [], stay: r.stay,
    holderPhone: r.phone,
  };
}

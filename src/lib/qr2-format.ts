/*
 * Smart QR "TF2" — byte layout, shared by the server (qr2.ts), the scanner (qr2-client.ts) and scripts.
 * Pure code: no Node or browser APIs, no imports.
 *
 *   QR text = <site>/t/<P>#<F>[.<L>]
 *   P (public, 24 bytes)  = 0x02 · ticketId(16) · keyEpoch(1) · pathTag(6)
 *   F (never sent to the server by a browser) = nonce(12) · sections · ECDSA P-256 signature(64, IEEE-P1363)
 *       section = roleId(1) · len(1) · AES-256-GCM ciphertext + 4-byte tag (AAD = P)
 *       signature covers "TF2" · P · nonce · sections
 *   L (optional, 4 bytes) = live code, changes every 30 s (only on the ticket screen)
 */

export const ROLES = ['gate', 'lunch', 'stay', 'org'] as const;
export type SealRole = (typeof ROLES)[number];
// Ids are fixed forever: 4 is retired (Oct 18, 2026) — never reuse it.
export const ROLE_ID: Record<SealRole, number> = { gate: 1, lunch: 2, stay: 3, org: 5 };
export const P_LEN = 24;
export const NONCE_LEN = 12;
export const SIG_LEN = 64;
export const TAG_LEN = 4;
export const LIVE_STEP_SECONDS = 30;
export const NAME_MAX = 26;      // bytes (UTF-8) — fits one Kannada/Hindi word (3 bytes per letter)
export const TYPE_MAX = 12;      // bytes

// ─── base64url (canonical: a string that doesn't re-encode to itself is rejected) ───
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function b64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (left > 1 ? B64[(n >> 6) & 63] : '') + (left > 2 ? B64[n & 63] : '');
  }
  return out;
}
export function unb64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 6) / 8));
  let bits = 0, acc = 0, j = 0;
  for (const ch of s) {
    acc = (acc << 6) | B64.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; out[j++] = (acc >> bits) & 255; }
  }
  return b64u(out) === s ? out : null;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * UTF-8 bytes of `s`, at most `max` bytes. Cuts only between whole letters (grapheme clusters, so a Kannada
 * or Hindi vowel sign is never split off its letter) and prefers ending at a word; a cut name ends in "…".
 */
export function utf8Max(s: string, max: number, atWord = true): Uint8Array {
  const full = utf8(s);
  if (full.length <= max) return full;
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    : Array.from(s);
  const room = max - 3; // leave space for "…"
  let out = '', lastSpace = -1;
  for (const g of seg) {
    if (utf8(out + g).length > room) break;
    if (/\s/.test(g)) lastSpace = out.length;
    out += g;
  }
  if (atWord && lastSpace >= out.length / 2) out = out.slice(0, lastSpace); // don't cut back to a lone initial
  return utf8(out.trimEnd() + '…');
}

export function uuidBytes(u: string): Uint8Array {
  const h = u.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}
export function bytesUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ─── P ───
export function packP(ticketId: string, epoch: number, pathTag: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(2), uuidBytes(ticketId), Uint8Array.of(epoch & 255), pathTag.slice(0, 6));
}
export function parseP(p: Uint8Array): { ticketId: string; epoch: number; pathTag: Uint8Array } | null {
  if (p.length !== P_LEN || p[0] !== 2) return null;
  return { ticketId: bytesUuid(p.slice(1, 17)), epoch: p[17], pathTag: p.slice(18, 24) };
}

// ─── F ───
export type Section = { role: number; ct: Uint8Array };
export function packSections(sections: Section[]): Uint8Array {
  return concat(...sections.map((s) => concat(Uint8Array.of(s.role, s.ct.length), s.ct)));
}
export function parseF(f: Uint8Array): { nonce: Uint8Array; body: Uint8Array; sections: Section[]; sig: Uint8Array } | null {
  if (f.length < NONCE_LEN + SIG_LEN) return null;
  const nonce = f.slice(0, NONCE_LEN), body = f.slice(NONCE_LEN, f.length - SIG_LEN), sig = f.slice(f.length - SIG_LEN);
  const sections: Section[] = [];
  for (let i = 0; i < body.length;) {
    if (i + 2 > body.length) return null;
    const role = body[i], len = body[i + 1];
    if (len < TAG_LEN || i + 2 + len > body.length) return null;
    sections.push({ role, ct: body.slice(i + 2, i + 2 + len) });
    i += 2 + len;
  }
  return { nonce, body, sections, sig };
}
export const signedMessage = (p: Uint8Array, nonce: Uint8Array, body: Uint8Array) => concat(utf8('TF2'), p, nonce, body);

// ─── Whole text ───
export const isTf2Text = (text: string) => /\/t\/[A-Za-z0-9_-]+/.test(text);
/** Split a scanned TF2 text into its base64url parts (the host is ignored — the signature is what counts). */
export function splitTf2(text: string): { p: string; f: string | null; l: string | null } | null {
  const m = text.trim().match(/\/t\/([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?)?$/);
  if (!m) return null;
  return { p: m[1], f: m[2] ?? null, l: m[3] ?? null };
}
export const tf2Url = (site: string, p: Uint8Array, f: Uint8Array, live?: Uint8Array) =>
  `${site.replace(/\/+$/, '')}/t/${b64u(p)}#${b64u(f)}${live ? `.${b64u(live)}` : ''}`;

export const liveStep = (nowMs: number) => Math.floor(nowMs / 1000 / LIVE_STEP_SECONDS);
export function stepBytes(step: number): Uint8Array {
  const b = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) { b[i] = n % 256; n = Math.floor(n / 256); }
  return b;
}
/** A live code counts as "live" if it was made from 2 steps ago (≈ 60–90 s) up to 1 step ahead (clock drift). */
export const LIVE_WINDOW = [-2, -1, 0, 1];

// ─── Section contents ───
function bcd(phone: string): Uint8Array {
  const d = phone.replace(/\D/g, '').slice(-10).padStart(10, '0');
  return Uint8Array.from({ length: 5 }, (_, i) => (Number(d[i * 2]) << 4) | Number(d[i * 2 + 1]));
}
const unbcd = (b: Uint8Array) => Array.from(b, (x) => `${x >> 4}${x & 15}`).join('');

export type GateData = { liveSecret: Uint8Array; name: string; type: string };
export const encGate = (g: GateData) => concat(g.liveSecret.slice(0, 8), utf8Max(g.name, NAME_MAX), Uint8Array.of(0x1f), utf8Max(g.type, TYPE_MAX, false));
export function decGate(b: Uint8Array): GateData | null {
  const sep = b.indexOf(0x1f, 8);
  if (b.length < 9 || sep < 0) return null;
  return { liveSecret: b.slice(0, 8), name: fromUtf8(b.slice(8, sep)), type: fromUtf8(b.slice(sep + 1)) };
}

/** Whole days from a to b ('YYYY-MM-DD'). */
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/** Lunch days as bits from the fest's first day (bit 0 = day 1). 1 byte, or 2 when the fest runs more than 8 days. */
export function encLunch(startsOn: string, endsOn: string, days: string[]): Uint8Array {
  const long = dayDiff(startsOn, endsOn) + 1 > 8;
  let mask = 0;
  for (const d of days) { const i = dayDiff(startsOn, d); if (i >= 0 && i < (long ? 16 : 8)) mask |= 1 << i; }
  return long ? Uint8Array.of(mask & 255, mask >> 8) : Uint8Array.of(mask);
}
export const decLunch = (b: Uint8Array) => (b[0] ?? 0) | ((b[1] ?? 0) << 8);
/** "Lunch today?" from the mask, plus "day x of y" like the server says it. */
export function lunchToday(mask: number, startsOn: string, today: string) {
  const i = dayDiff(startsOn, today);
  const total = mask.toString(2).split('').filter((c) => c === '1').length;
  const ok = i >= 0 && i < 16 && (mask & (1 << i)) !== 0;
  const x = ok ? (mask & ((1 << i) - 1)).toString(2).split('').filter((c) => c === '1').length + 1 : 0;
  return { ok, x, total };
}

export const encStay = (stay: boolean) => Uint8Array.of(stay ? 1 : 0);
export const decStay = (b: Uint8Array) => (b[0] & 1) === 1;

export const encOrg = (phone: string) => bcd(phone);
export const decOrg = (b: Uint8Array) => (b.length === 5 ? unbcd(b) : null);

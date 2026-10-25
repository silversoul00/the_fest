// Pure helpers — safe on client and server.

export function rupees(paise: number, opts: { compact?: boolean } = {}): string {
  const r = paise / 100;
  if (opts.compact) {
    if (r >= 1e7) return '₹' + trim(r / 1e7) + 'Cr';
    if (r >= 1e5) return '₹' + trim(r / 1e5) + 'L';
    if (r >= 1e3) return '₹' + trim(r / 1e3) + 'k';
  }
  // Whole rupees show no decimals; otherwise always two (₹6,024.10, not ₹6,024.1).
  const d = Number.isInteger(Math.round(r * 100) / 100) ? 0 : 2;
  return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString();

export function num(n: number): string {
  return n.toLocaleString('en-IN');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-20" → Date at local midnight (avoids UTC off-by-one) */
export function parseDay(d: string | Date): Date {
  if (d instanceof Date) return d;
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day);
}

export function dateRange(start: string | Date, end: string | Date): string {
  const a = parseDay(start), b = parseDay(end);
  if (a.getTime() === b.getTime()) return `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
    return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}, ${a.getFullYear()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}

export function shortDate(d: string | Date): string {
  const a = parseDay(d);
  return `${MONTHS[a.getMonth()]} ${a.getDate()}`;
}

const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };

export function time(d: Date | string): string {
  return new Date(d).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit', hour12: true });
}

export function dayLabel(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short' });
}

export function ago(d: Date | string): string {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => graphemes(w)[0]).slice(0, 2).join('').toUpperCase() || '?';
}

// Indian scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam) share one
// layout inside their 128-character Unicode blocks, so one table (by offset in the block) transliterates them all.
const VOWELS: Record<number, string> = {
  0x05: 'a', 0x06: 'a', 0x07: 'i', 0x08: 'i', 0x09: 'u', 0x0a: 'u', 0x0b: 'ri', 0x0c: 'li', 0x0d: 'e', 0x0e: 'e', 0x0f: 'e',
  0x10: 'ai', 0x11: 'o', 0x12: 'o', 0x13: 'o', 0x14: 'au', 0x60: 'ri', 0x61: 'li',
};
const CONS = ('k kh g gh ng ch chh j jh ny t th d dh n t th d dh n n p ph b bh m y r r l l l v sh sh s h').split(' ');
const EXTRA: Record<number, string> = { 0x58: 'q', 0x59: 'kh', 0x5a: 'g', 0x5b: 'z', 0x5c: 'd', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y' };
const MATRAS: Record<number, string> = {
  0x3e: 'a', 0x3f: 'i', 0x40: 'i', 0x41: 'u', 0x42: 'u', 0x43: 'ri', 0x44: 'ri', 0x45: 'e', 0x46: 'e', 0x47: 'e',
  0x48: 'ai', 0x49: 'o', 0x4a: 'o', 0x4b: 'o', 0x4c: 'au', 0x62: 'li', 0x63: 'li',
};

/** "ನಮ್ಮ ಉತ್ಸವ" → "namma utsava", "नमस्ते" → "namaste", "Café" → "Cafe". Other scripts pass through. */
export function transliterate(s: string): string {
  let out = '';
  let inherent = false; // the last letter was a consonant whose built-in "a" may still be replaced
  for (const ch of s.normalize('NFC').replace(/[\u200c\u200d]/g, '')) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x0900 || cp > 0x0d7f) { out += ch; inherent = false; continue; }
    const o = cp & 0x7f;
    if (o >= 0x15 && o <= 0x39) { out += CONS[o - 0x15] + 'a'; inherent = true; }
    else if (EXTRA[o] && cp < 0x0980) { out += EXTRA[o] + 'a'; inherent = true; }
    else if (VOWELS[o]) { out += VOWELS[o]; inherent = false; }
    else if (MATRAS[o] || o === 0x4d) { if (inherent) out = out.slice(0, -1); out += MATRAS[o] ?? ''; inherent = false; }
    else if (o === 0x01 || o === 0x02) { out += 'n'; inherent = false; }
    else if (o === 0x03) { out += 'h'; inherent = false; }
    else if (o >= 0x66 && o <= 0x6f) { out += String(o - 0x66); inherent = false; }
    else if (o === 0x3c || o === 0x00 || (o >= 0x51 && o <= 0x57)) { /* nukta, accents, length marks: no sound of their own */ }
    else { out += ' '; inherent = false; }
  }
  return out.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function slugify(s: string): string {
  return transliterate(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

/**
 * Slug for a new fest. Names in any Indian script are transliterated; if that still gives nothing useful
 * (emoji, Chinese, just "Fest"), college + city + year are used so links stay readable and different.
 */
export function festSlug(f: { slug?: string; name: string; college: string; city: string; starts_on: string }): string {
  const year = f.starts_on.slice(0, 4);
  let slug = slugify(f.slug || f.name);
  const generic = (x: string) => x.replace(/-?(fest|festival|utsav|utsava|\d+)-?/g, '').length < 3;
  if (generic(slug)) slug = slugify([f.name, f.college, f.city].map((x) => slugify(x)).filter(Boolean).join(' '));
  // "-fest-2026-ab12" is 15 characters; keep the whole slug within the 48 the database allows
  if (generic(slug)) slug = `${slug ? slug.slice(0, 33).replace(/-+$/, '') + '-' : ''}fest-${year}-${Math.random().toString(36).slice(2, 6)}`;
  return slug;
}

/** Split into whole letters (user-perceived characters), e.g. "ಕ್ಕ" or "👍🏽" stay one piece. */
export function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : Array.from(s);
}

/** Shorten to at most `max` characters (UTF-16 units, like String.slice) without splitting a letter. No "…". */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  for (const g of graphemes(s)) { if (out.length + g.length > max) break; out += g; }
  return out;
}

/** Cut text to at most `max` whole letters (a Kannada/Hindi letter with its vowel sign, or an emoji, counts as one). */
export function cutText(s: string, max: number): string {
  const parts = graphemes(s);
  return parts.length <= max ? s : parts.slice(0, max).join('').trimEnd() + '…';
}

/**
 * A redirect target typed or linked by a user ("?next=") is only followed when it is a path on this site:
 * starts with one "/", no "//" or backslash (browsers treat "/\\evil.com" as "//evil.com"), no control characters
 * or schemes — also after URL-decoding, and also after "/../" segments are resolved ("/..//evil.com" is "//evil.com").
 * Letters outside ASCII (e.g. "/fests/ನ") are sent percent-encoded: a raw one in the Location header crashes the
 * redirect. Broken percent-encoding ("%ZZ", "%E0%A4") gives ''. Anything rejected gives '' (the caller then uses the portal).
 */
export function safeNext(n: unknown): string {
  if (typeof n !== 'string' || n.length > 500) return '';
  let d = n;
  for (let i = 0; i < 3; i++) {
    let x: string;
    try { x = decodeURIComponent(d); } catch { return ''; }
    if (x === d) break;
    d = x;
  }
  for (const v of [n, d]) {
    if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f\u007f\s]/.test(v)) return '';
  }
  // Header-safe: every character outside printable ASCII becomes %XX (a lone surrogate can't be encoded → '')
  let out: string;
  try { out = n.replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c)); } catch { return ''; }
  if (out.length > 1500) return '';
  const base = 'https://thefest.invalid';
  try {
    for (const v of [out, d]) {
      const u = new URL(v, base);
      if (u.origin !== base || u.pathname.startsWith('//') || u.pathname.includes('\\')) return '';
    }
  } catch { return ''; }
  return out;
}

/** Today's date in India as 'YYYY-MM-DD' (fests run on IST, servers run on UTC). */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

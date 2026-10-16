// Pure helpers — safe on client and server.

export function rupees(paise: number, opts: { compact?: boolean } = {}): string {
  const r = paise / 100;
  if (opts.compact) {
    if (r >= 1e7) return '₹' + trim(r / 1e7) + 'Cr';
    if (r >= 1e5) return '₹' + trim(r / 1e5) + 'L';
    if (r >= 1e3) return '₹' + trim(r / 1e3) + 'k';
  }
  return '₹' + r.toLocaleString('en-IN', { maximumFractionDigits: r % 1 ? 2 : 0 });
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
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

/** Today's date in India as 'YYYY-MM-DD' (fests run on IST, servers run on UTC). */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

import 'server-only';
import { checkTicketKeys } from './ticket-crypto';

/*
 * One place for "where are we running and is everything set up?".
 *
 * Nothing here throws at import time, so `next build` works with no env vars at all.
 * Problems are reported by NAME only — never the value — so /api/health is safe to make public.
 */

// Read at runtime. A literal `process.env.NEXT_PUBLIC_…` would be frozen into the bundle at build time,
// and then a missing or changed value wouldn't be noticed until the next build.
const env = (name: string): string => (process.env[name] ?? '').trim();

export type AppEnv = 'production' | 'preview' | 'development';

/**
 * production  — Vercel production deployment, or APP_ENV=production (lets tests simulate production locally).
 * preview     — a Vercel preview deployment (every pushed branch).
 * development — everything else (your computer, the local release check).
 */
export function appEnv(): AppEnv {
  if (env('VERCEL_ENV') === 'production' || env('APP_ENV') === 'production') return 'production';
  if (env('VERCEL_ENV') === 'preview') return 'preview';
  return 'development';
}

export class ConfigError extends Error {}

const isLocal = (url: string) => /(^|\/\/|@)(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url);

/**
 * The public address of the site, used in emails, payment return links and booth QR codes.
 * Never falls back to localhost outside development: production without an address throws
 * (and /api/health lists NEXT_PUBLIC_SITE_URL), so nobody gets an email with a dead link.
 */
export function siteUrl(): string {
  const set = env('NEXT_PUBLIC_SITE_URL').replace(/\/+$/, '');
  const e = appEnv();
  if (set && !(e === 'production' && isLocal(set))) return set;
  if (e === 'preview' && env('VERCEL_BRANCH_URL')) return `https://${env('VERCEL_BRANCH_URL')}`;
  if (e === 'preview' && env('VERCEL_URL')) return `https://${env('VERCEL_URL')}`;
  if (e === 'production' && env('VERCEL_PROJECT_PRODUCTION_URL')) return `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}`;
  if (e === 'development') return set || 'http://localhost:3000';
  throw new ConfigError('NEXT_PUBLIC_SITE_URL is not set, so links in emails and payments would be broken.');
}

/** Like siteUrl(), but returns null instead of throwing (for pages that only show the link). */
export function siteUrlOrNull(): string | null {
  try { return siteUrl(); } catch { return null; }
}

/* ─── Database URL checks ─────────────────────────────────────────── */
function dbHostPort(url: string): { host: string; port: string } | null {
  // Passwords with special characters can break URL parsing, so read host:port after the last '@'.
  const m = url.match(/@([^/@?]+?)(?::(\d+))?(?:[/?]|$)/);
  return m ? { host: m[1].toLowerCase(), port: m[2] ?? '5432' } : null;
}

export const isLocalDatabase = (url = env('DATABASE_URL')) => {
  const hp = dbHostPort(url);
  return !!hp && ['localhost', '127.0.0.1', '[::1]'].includes(hp.host);
};

/* ─── Gateway key checks (read here so payments.ts and health agree) ── */
export const cashfreeKeysSet = () => !!(env('CASHFREE_APP_ID') && env('CASHFREE_SECRET_KEY'));
export const razorpayKeysSet = () => !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET'));
export const cashfreeLive = () => cashfreeKeysSet() && env('CASHFREE_ENV') === 'production';
export const razorpayLive = () => razorpayKeysSet() && env('RAZORPAY_KEY_ID').startsWith('rzp_live_');

/**
 * Settings that are missing or wrong. Names only, never values.
 * Any problem → /api/health answers 503 so an uptime monitor alerts.
 */
export function configProblems(): string[] {
  const p: string[] = [];
  const prod = appEnv() === 'production';

  const db = env('DATABASE_URL');
  if (!db) p.push('DATABASE_URL');
  else if (prod && !isLocalDatabase(db)) {
    const hp = dbHostPort(db);
    if (!hp || hp.port !== '6543' || hp.host.startsWith('db.')) p.push('DATABASE_URL_NOT_TRANSACTION_POOLER');
  }

  const keys = checkTicketKeys();
  if (keys === 'missing' || keys === 'invalid') p.push('TICKET_PRIVATE_KEY');
  else if (keys === 'public_invalid') p.push('TICKET_PUBLIC_KEY');
  else if (keys === 'mismatch') p.push('TICKET_KEYS_MISMATCH');

  if (prod) {
    const site = env('NEXT_PUBLIC_SITE_URL');
    if (!site || !site.startsWith('https://') || /localhost|127\.0\.0\.1/i.test(site)) p.push('NEXT_PUBLIC_SITE_URL');
    if (!env('RESEND_API_KEY')) p.push('RESEND_API_KEY');
    if (!env('ADMIN_EMAILS')) p.push('ADMIN_EMAILS');
    const cfTest = cashfreeKeysSet() && !cashfreeLive();
    const rzTest = razorpayKeysSet() && !razorpayLive();
    if (cfTest || rzTest) p.push('GATEWAY_TEST_KEYS_IN_PRODUCTION');
  }
  return p;
}

/** Things worth knowing that don't stop the site working (bank UPI and free tickets still work). */
export function configWarnings(): string[] {
  const w: string[] = [];
  if (appEnv() !== 'production') return w;
  if (!cashfreeLive() && !razorpayLive()) w.push('NO_LIVE_GATEWAY');
  // Ignored in production (demo checkout never runs there), but it shouldn't be set at all.
  if (env('DEMO_PAYMENTS') || env('APP_ENV')) w.push('TEST_SETTING_IN_PRODUCTION');
  return w;
}

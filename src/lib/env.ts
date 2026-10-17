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
 * production  — fails SAFE. Any of:
 *                 • VERCEL_ENV=production, or APP_ENV=production (lets tests simulate production locally);
 *                 • a production build (NODE_ENV=production, i.e. `next start` / Vercel) whose database is NOT
 *                   on this machine — unless VERCEL_ENV explicitly says preview or development.
 *               So if Vercel ever runs without VERCEL_ENV, it is still treated as production
 *               (no demo payments, no sandbox/test keys).
 * preview     — a Vercel preview deployment (every pushed branch), VERCEL_ENV=preview.
 * development — `next dev`, the local release check (production build on a local database), VERCEL_ENV=development.
 */
export function appEnv(): AppEnv {
  const vercel = env('VERCEL_ENV').toLowerCase();
  if (vercel === 'production' || env('APP_ENV').toLowerCase() === 'production') return 'production';
  if (vercel === 'preview') return 'preview';
  if (vercel === 'development') return 'development';
  if (env('NODE_ENV') === 'production' && !isLocalDatabase()) return 'production';
  return 'development';
}

export class ConfigError extends Error {}

const isLocal = (url: string) => /(^|\/\/|@)(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url);

/**
 * The public address of the site, used in emails, payment return links and booth QR codes.
 * Never uses localhost outside development (even if NEXT_PUBLIC_SITE_URL says so): production without an address throws
 * (and /api/health lists NEXT_PUBLIC_SITE_URL), so nobody gets an email with a dead link.
 */
export function siteUrl(): string {
  const set = env('NEXT_PUBLIC_SITE_URL').replace(/\/+$/, '');
  const e = appEnv();
  if (set && !(e !== 'development' && isLocal(set))) return set; // a pasted localhost value is ignored on preview/production
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

/**
 * Is the database on this machine? localhost, 127.0.0.1, ::1, or a unix socket
 * (postgres:///db, postgres://user@/db, ?host=/var/run/postgresql). Anything else counts as remote.
 */
export const isLocalDatabase = (url = env('DATABASE_URL')) => {
  if (!url) return false;
  if (/[?&]host=(%2F|\/)/i.test(url)) return true;                 // ?host=/tmp → unix socket
  if (/^postgres(ql)?:\/\/([^/@]*@)?\//i.test(url)) return true;  // no host at all → unix socket
  const hp = dbHostPort(url) ?? (() => {
    const m = url.match(/^postgres(?:ql)?:\/\/([^/:?]+)(?::(\d+))?/i);
    return m ? { host: m[1].toLowerCase(), port: m[2] ?? '5432' } : null;
  })();
  return !!hp && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hp.host);
};

/* ─── Gateway key checks (one place, always trimmed, so payments.ts, cashfree.ts and health agree) ── */
export const cashfreeKeysSet = () => !!(env('CASHFREE_APP_ID') && env('CASHFREE_SECRET_KEY'));
export const razorpayKeysSet = () => !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET'));
/** Which Cashfree server to call. Only the exact word "production" (any case, spaces ignored) means live. */
export const cashfreeEnvSetting = (): 'sandbox' | 'production' =>
  env('CASHFREE_ENV').toLowerCase() === 'production' ? 'production' : 'sandbox';
/** Cashfree sandbox keys: the app id starts with TEST, the secret contains _test_ (e.g. cfsk_ma_test_…). */
export const cashfreeTestKeys = () =>
  cashfreeKeysSet() && (/^test/i.test(env('CASHFREE_APP_ID')) || /_test_/i.test(env('CASHFREE_SECRET_KEY')));
export const cashfreeLive = () => cashfreeKeysSet() && cashfreeEnvSetting() === 'production' && !cashfreeTestKeys();
export const razorpayTestKeys = () => razorpayKeysSet() && !env('RAZORPAY_KEY_ID').startsWith('rzp_live_');
export const razorpayLive = () => razorpayKeysSet() && !razorpayTestKeys();
/** DEMO_PAYMENTS=1 asks for the pretend checkout (local testing only). */
export const demoPaymentsRequested = () => env('DEMO_PAYMENTS') === '1';

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
    // Never sandbox/test keys in production (they are ignored there, but must be fixed).
    if (cashfreeTestKeys() || razorpayTestKeys()) p.push('GATEWAY_TEST_KEYS_IN_PRODUCTION');
    // Live-looking Cashfree keys but CASHFREE_ENV isn't "production": calls would go to the sandbox and fail.
    else if (cashfreeKeysSet() && !cashfreeLive()) p.push('CASHFREE_ENV');
    // Never pretend payments in production (ignored there too, but it must not be set).
    if (env('DEMO_PAYMENTS')) p.push('DEMO_PAYMENTS_IN_PRODUCTION');
  }
  return p;
}

/** Things worth knowing that don't stop the site working (bank UPI and free tickets still work). */
export function configWarnings(): string[] {
  const w: string[] = [];
  if (appEnv() !== 'production') return w;
  if (!cashfreeLive() && !razorpayLive()) w.push('NO_LIVE_GATEWAY');
  // APP_ENV is only for simulating production in tests; harmless on Vercel, but not needed there.
  if (env('APP_ENV')) w.push('TEST_SETTING_IN_PRODUCTION');
  return w;
}

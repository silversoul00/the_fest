import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FeeConfig } from './pricing';
import { appEnv, cashfreeKeysSet, cashfreeLive, demoPaymentsRequested, razorpayKeysSet, razorpayLive } from './env';

/* ─── Commission settings (env) ───────────────────────────────────────
 * PLATFORM_FEE_MODE        flat | percent            (default flat)
 * PLATFORM_FEE_PAISE       flat fee per paid ticket   (default 1500 = ₹15)
 * PLATFORM_FEE_PERCENT     % of ticket price          (default 5)
 * PLATFORM_FEE_MIN_PAISE   floor in percent mode      (default 800 = ₹8)
 * PLATFORM_FEE_MAX_PAISE   cap in percent mode, 0=none (default 3000 = ₹30)
 * PLATFORM_FEE_PAYER       student | organizer        (default student)
 * GATEWAY_RATE             gateway % incl. GST        (default 0.0236)
 * PASS_GATEWAY_FEE         true | false               (default true)
 */
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function feeConfig(): FeeConfig {
  return {
    mode: process.env.PLATFORM_FEE_MODE === 'percent' ? 'percent' : 'flat',
    flatPaise: num(process.env.PLATFORM_FEE_PAISE, 1500),
    percent: num(process.env.PLATFORM_FEE_PERCENT, 5),
    minPaise: num(process.env.PLATFORM_FEE_MIN_PAISE, 800),
    maxPaise: num(process.env.PLATFORM_FEE_MAX_PAISE, 3000),
    payer: process.env.PLATFORM_FEE_PAYER === 'organizer' ? 'organizer' : 'student',
    gatewayRate: num(process.env.GATEWAY_RATE, 0.0236),
    passGateway: process.env.PASS_GATEWAY_FEE !== 'false',
  };
}

/* ─── Which card/UPI gateway is live ──────────────────────────────────
 * PAYMENT_GATEWAY=cashfree|razorpay forces one; otherwise Cashfree is used
 * when its keys are set, then Razorpay.
 *
 * Money can never be fake in production:
 *  • In production only LIVE keys count (CASHFREE_ENV=production and no TEST app id; rzp_live_…). Test keys there
 *    mean "no gateway", so a sandbox payment can never issue a real ticket.
 *  • 'demo' (pretend payment) only when no gateway is configured, DEMO_PAYMENTS=1, and not production.
 *  • Otherwise 'none': card/UPI checkout is switched off; bank UPI and free tickets still work.
 */
export type Gateway = 'cashfree' | 'razorpay' | 'demo' | 'none';
export const cashfreeEnabled = () => cashfreeKeysSet() && (appEnv() !== 'production' || cashfreeLive());
export const razorpayEnabled = () => razorpayKeysSet() && (appEnv() !== 'production' || razorpayLive());

export function activeGateway(): Gateway {
  const forced = (process.env.PAYMENT_GATEWAY ?? '').trim().toLowerCase();
  if (forced === 'cashfree' && cashfreeEnabled()) return 'cashfree';
  if (forced === 'razorpay' && razorpayEnabled()) return 'razorpay';
  if (cashfreeEnabled()) return 'cashfree';
  if (razorpayEnabled()) return 'razorpay';
  const anyKeys = cashfreeKeysSet() || razorpayKeysSet();
  if (!anyKeys && demoPaymentsRequested() && appEnv() !== 'production') return 'demo';
  return 'none';
}

/** May we trust a payment confirmation from this provider right now? (No sandbox confirmations in production.) */
export function providerTrusted(provider: 'cashfree' | 'razorpay'): boolean {
  return provider === 'cashfree' ? cashfreeEnabled() : razorpayEnabled();
}

/** Short label for the admin System card. */
export function gatewayLabel(): string {
  const g = activeGateway();
  if (g === 'cashfree') return cashfreeLive() ? 'cashfree live' : 'cashfree test';
  if (g === 'razorpay') return razorpayLive() ? 'razorpay live' : 'razorpay test';
  return g;
}

/* ─── Razorpay ────────────────────────────────────────────────────── */
const trimmed = (name: string) => (process.env[name] ?? '').trim();
export const razorpayKeyId = () => trimmed('RAZORPAY_KEY_ID');
const rzpKeys = () => ({ key_id: razorpayKeyId(), key_secret: trimmed('RAZORPAY_KEY_SECRET') });
function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret) */
export function verifyCheckoutSignature(rzpOrderId: string, rzpPaymentId: string, signature: string, secret = trimmed('RAZORPAY_KEY_SECRET')) {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
  return safeEq(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook_secret) */
export function verifyWebhookSignature(rawBody: string, signature: string, secret = trimmed('RAZORPAY_WEBHOOK_SECRET')) {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEq(expected, signature);
}

export async function createRazorpayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  const Razorpay = (await import('razorpay')).default;
  const rzp = new Razorpay(rzpKeys());
  const order = await rzp.orders.create({ amount: amountPaise, currency: 'INR', receipt, notes });
  return order as { id: string; amount: number; currency: string };
}

export async function refundRazorpay(paymentId: string, amountPaise: number, note: string) {
  const Razorpay = (await import('razorpay')).default;
  const rzp = new Razorpay(rzpKeys());
  return rzp.payments.refund(paymentId, { amount: amountPaise, notes: { reason: note.slice(0, 200) } });
}

/** Total already refunded at Razorpay for this payment, in paise. */
export async function razorpayRefundedTotal(paymentId: string): Promise<number> {
  const Razorpay = (await import('razorpay')).default;
  const rzp = new Razorpay(rzpKeys());
  const p = await rzp.payments.fetch(paymentId);
  return Number(p.amount_refunded ?? 0);
}

export { safeEq };

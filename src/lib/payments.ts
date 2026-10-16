import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const razorpayEnabled = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

/** THE FEST commission per paid ticket (paise). Default ₹15. */
export const platformFeePaise = () => Number(process.env.PLATFORM_FEE_PAISE ?? 1500);

/** 'student' → fee added on top at checkout (convenience fee).
 *  'organizer' → student pays ticket price only; fee deducted from organizer payout. */
export const feePayer = (): 'student' | 'organizer' =>
  process.env.PLATFORM_FEE_PAYER === 'organizer' ? 'organizer' : 'student';

export function priceOrder(pricePaise: number, qty: number) {
  const subtotal = pricePaise * qty;
  const fee = pricePaise > 0 ? platformFeePaise() * qty : 0;
  const total = feePayer() === 'student' ? subtotal + fee : subtotal;
  return { subtotal, fee, total };
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret) */
export function verifyCheckoutSignature(rzpOrderId: string, rzpPaymentId: string, signature: string, secret = process.env.RAZORPAY_KEY_SECRET ?? '') {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');
  return safeEq(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook_secret) */
export function verifyWebhookSignature(rawBody: string, signature: string, secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '') {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEq(expected, signature);
}

export async function createRazorpayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  const Razorpay = (await import('razorpay')).default;
  const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
  const order = await rzp.orders.create({ amount: amountPaise, currency: 'INR', receipt, notes });
  return order as { id: string; amount: number; currency: string };
}

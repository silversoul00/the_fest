import 'server-only';
import { clip } from './format';
import { createHmac } from 'node:crypto';
import { safeEq } from './payments';
import { cashfreeEnvSetting } from './env';

/*
 * Cashfree Payment Gateway (PG API, version 2023-08-01).
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=sandbox|production
 * Docs: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
 *
 * Our order UUID is used as Cashfree's order_id, so lookups need no mapping.
 */
const API_VERSION = '2023-08-01';
// Same trimmed reading as health and payments.ts (env.ts), so they can never disagree about live vs sandbox.
export const cashfreeMode = (): 'sandbox' | 'production' => cashfreeEnvSetting();
const key = (name: string) => (process.env[name] ?? '').trim();
const base = () => (cashfreeMode() === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg');

async function cf<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(base() + path, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': key('CASHFREE_APP_ID'),
      'x-client-secret': key('CASHFREE_SECRET_KEY'),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string }).message ?? `Cashfree ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function createCashfreeOrder(o: {
  orderId: string; amountPaise: number; returnUrl: string; notifyUrl: string;
  customer: { id: string; phone: string; email: string; name: string };
  note?: string;
}) {
  const r = await cf<{ order_id: string; payment_session_id: string; order_status: string }>('/orders', {
    method: 'POST',
    body: {
      order_id: o.orderId,
      order_amount: Number((o.amountPaise / 100).toFixed(2)),
      order_currency: 'INR',
      customer_details: {
        customer_id: o.customer.id.replace(/-/g, '').slice(0, 50),
        customer_phone: o.customer.phone,
        customer_email: o.customer.email,
        customer_name: clip(o.customer.name, 100),
      },
      order_meta: { return_url: o.returnUrl, notify_url: o.notifyUrl },
      order_note: (o.note ?? 'THE FEST tickets').slice(0, 200),
    },
  });
  return { cfOrderId: r.order_id, paymentSessionId: r.payment_session_id };
}

/** Ask Cashfree whether the order has been paid (the source of truth). */
export async function getCashfreePayment(orderId: string): Promise<{ paid: boolean; paymentId?: string; amountPaise?: number }> {
  const order = await cf<{ order_status: string; order_amount: number }>(`/orders/${encodeURIComponent(orderId)}`);
  if (order.order_status !== 'PAID') return { paid: false };
  const payments = await cf<{ cf_payment_id: string | number; payment_status: string; payment_amount: number }[]>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
  ).catch(() => []);
  const ok = payments.find((p) => p.payment_status === 'SUCCESS');
  return { paid: true, paymentId: ok ? String(ok.cf_payment_id) : undefined, amountPaise: Math.round(order.order_amount * 100) };
}

/** Webhook signature: base64(HMAC_SHA256(timestamp + rawBody, secret_key)) */
export function verifyCashfreeWebhook(rawBody: string, timestamp: string, signature: string, secret = key('CASHFREE_SECRET_KEY')) {
  if (!secret || !timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  return safeEq(expected, signature);
}

export async function refundCashfree(orderId: string, amountPaise: number, refundId: string, note: string) {
  return cf<{ cf_refund_id: string; refund_status: string }>(`/orders/${encodeURIComponent(orderId)}/refunds`, {
    method: 'POST',
    body: { refund_amount: Number((amountPaise / 100).toFixed(2)), refund_id: refundId.slice(0, 40), refund_note: note.slice(0, 100) },
  });
}

/** Total already refunded (or in progress) at Cashfree for this order, in paise. */
export async function cashfreeRefundedTotal(orderId: string): Promise<number> {
  const list = await cf<{ refund_amount: number; refund_status: string }[]>(`/orders/${encodeURIComponent(orderId)}/refunds`);
  return (Array.isArray(list) ? list : [])
    .filter((r) => !['CANCELLED', 'FAILED'].includes(String(r.refund_status).toUpperCase()))
    .reduce((s, r) => s + Math.round(Number(r.refund_amount) * 100), 0);
}

/** Deterministic refund id: the same refund step always gets the same id, so a retry can't pay twice. */
export const cashfreeRefundId = (orderId: string, refundedAfterPaise: number) =>
  `rf${orderId.replace(/-/g, '')}${refundedAfterPaise.toString(36)}`.slice(0, 40);

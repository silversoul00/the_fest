import { sql } from '@/lib/db';
import { fail, isUuid, json } from '@/lib/http';
import { getCashfreePayment, verifyCashfreeWebhook } from '@/lib/cashfree';
import { confirmCashfree } from '@/lib/confirm';
import { reportError } from '@/lib/errors';

// Cashfree dashboard → Developers → Webhooks → https://thefest.in/api/webhooks/cashfree
// Event: PAYMENT_SUCCESS_WEBHOOK. Backup for students who close the page before
// the checkout screen confirms. Signature = base64(HMAC_SHA256(timestamp + body, secret)).
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyCashfreeWebhook(raw, req.headers.get('x-webhook-timestamp') ?? '', req.headers.get('x-webhook-signature') ?? '');
  if (!ok) return fail('Invalid signature', 401);

  let evt: { type?: string; data?: { order?: { order_id?: string }; payment?: { payment_status?: string } } };
  try { evt = JSON.parse(raw); } catch { return fail('Bad JSON'); }
  if (evt.type !== 'PAYMENT_SUCCESS_WEBHOOK') return json({ ignored: evt.type });

  const orderId = evt.data?.order?.order_id;
  if (!isUuid(orderId)) return json({ ignored: 'unknown order id' });
  const [o] = await sql`select 1 from orders where id = ${orderId} and provider = 'cashfree'`;
  if (!o) return json({ ignored: 'unknown order' });

  // Re-check with Cashfree's API rather than trusting the webhook body alone
  try {
    const p = await getCashfreePayment(orderId);
    const r = await confirmCashfree(orderId, p);
    return json(r.ok ? { ok: true } : { ok: false, attention: r.error });
  } catch (e) {
    await reportError(e, 'cashfree webhook');
    return fail('Retry', 500);
  }
}

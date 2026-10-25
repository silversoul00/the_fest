import { sql } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { fulfilOrder, OrderError } from '@/lib/orders';
import { providerTrusted, verifyWebhookSignature } from '@/lib/payments';
import { reportError } from '@/lib/errors';

// Razorpay → Settings → Webhooks → URL: https://thefest.in/api/webhooks/razorpay
// Events: payment.captured, order.paid.  Guarantees tickets are issued even if
// the student closes the browser before the checkout callback returns.
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('x-razorpay-signature') ?? '';
  if (!verifyWebhookSignature(raw, sig)) return fail('Invalid signature', 401);
  if (!providerTrusted('razorpay')) return json({ ignored: 'test keys are not trusted in production' });

  let evt: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } }; order?: { entity?: { id?: string } } } };
  try { evt = JSON.parse(raw); } catch { return fail('Bad JSON'); }

  if (evt.event !== 'payment.captured' && evt.event !== 'order.paid') return json({ ignored: evt.event });

  const payment = evt.payload?.payment?.entity;
  const rzpOrderId = payment?.order_id ?? evt.payload?.order?.entity?.id;
  if (!rzpOrderId) return json({ ignored: 'no order id' });

  const [o] = await sql<{ id: string }[]>`select id from orders where razorpay_order_id = ${rzpOrderId}`;
  if (!o) return json({ ignored: 'unknown order' });

  try {
    const r = await fulfilOrder(o.id, { provider: 'razorpay', paymentId: payment?.id });
    return json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof OrderError) {
      await reportError(e, `razorpay webhook: order ${o.id} needs attention`);
      return json({ ok: false, attention: e.message }); // 200 so Razorpay stops retrying; flagged in logs
    }
    await reportError(e, 'razorpay webhook');
    return fail('Retry', 500); // Razorpay retries
  }
}

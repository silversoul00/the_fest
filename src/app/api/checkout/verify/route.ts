import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { fulfilOrder, OrderError } from '@/lib/orders';
import { providerTrusted, verifyCheckoutSignature } from '@/lib/payments';
import { notifyOrderPaid } from '@/lib/mail';
import { afterResponse, reportError } from '@/lib/errors';

// Called by the Razorpay checkout handler in the browser after payment.
// The webhook (/api/webhooks/razorpay) is the backup if this never arrives.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in.', 401);

  const b = await body<{ orderId?: string; razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }>(req);
  if (!b || !isUuid(b.orderId) || !b.razorpay_order_id || !b.razorpay_payment_id || !b.razorpay_signature) return fail('Missing payment details.');

  const [o] = await sql<{ razorpay_order_id: string | null }[]>`
    select razorpay_order_id from orders where id = ${b.orderId} and user_id = ${user.id}`;
  if (!o || o.razorpay_order_id !== b.razorpay_order_id) return fail('Order not found.', 404);

  if (!providerTrusted('razorpay')) return fail('Card payments are switched off right now.', 503);
  if (!verifyCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
    return fail('Payment could not be verified. If money was deducted it will be refunded automatically.', 400);
  }

  try {
    const r = await fulfilOrder(b.orderId, { provider: 'razorpay', paymentId: b.razorpay_payment_id });
    if (!r.already) await afterResponse('ticket email', () => notifyOrderPaid(b.orderId!));
    return json({ ok: true });
  } catch (e) {
    if (e instanceof OrderError) return fail(e.message, 409);
    await reportError(e, 'razorpay verify');
    return fail('Payment received but tickets could not be issued yet — they will appear shortly.', 500);
  }
}

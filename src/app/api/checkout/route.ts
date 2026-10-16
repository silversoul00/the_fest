import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { cancelOrder, createOrder, fulfilOrder, OrderError } from '@/lib/orders';
import { createRazorpayOrder, razorpayEnabled } from '@/lib/payments';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in to buy tickets.', 401);
  if (user.role !== 'student') return fail('Tickets are bought from a student account.', 403);

  const b = await body<{ ticketTypeId?: string; qty?: number }>(req);
  if (!b || !isUuid(b.ticketTypeId)) return fail('Choose a ticket type.');

  try {
    const o = await createOrder({ userId: user.id, ticketTypeId: b.ticketTypeId, qty: Number(b.qty ?? 1) });

    if (o.free) {
      await fulfilOrder(o.orderId, { provider: 'free' });
      return json({ mode: 'done', orderId: o.orderId });
    }

    if (!razorpayEnabled()) return json({ mode: 'demo', orderId: o.orderId, amount: o.amount });

    try {
      const rzp = await createRazorpayOrder(o.amount, o.orderId.slice(0, 40), { order_id: o.orderId, user_id: user.id });
      await sql`update orders set provider = 'razorpay', razorpay_order_id = ${rzp.id} where id = ${o.orderId}`;
      return json({ mode: 'razorpay', orderId: o.orderId, rzpOrderId: rzp.id, amount: o.amount, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (e) {
      console.error('Razorpay order create failed', e);
      await cancelOrder(o.orderId, user.id);
      return fail('Payment provider is unavailable right now. Please try again in a minute.', 502);
    }
  } catch (e) {
    if (e instanceof OrderError) return fail(e.message, 409);
    console.error('checkout failed', e);
    return fail('Could not start checkout. Please try again.', 500);
  }
}

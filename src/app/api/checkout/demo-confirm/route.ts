import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { fulfilOrder, OrderError } from '@/lib/orders';
import { razorpayEnabled } from '@/lib/payments';

// Demo checkout — only available while Razorpay keys are NOT configured.
// Once RAZORPAY_KEY_ID/SECRET are set, this endpoint refuses every request.
export async function POST(req: Request) {
  if (razorpayEnabled()) return fail('Demo payments are disabled.', 403);
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in.', 401);

  const b = await body<{ orderId?: string }>(req);
  if (!b || !isUuid(b.orderId)) return fail('Missing order.');
  const [o] = await sql`select 1 from orders where id = ${b.orderId} and user_id = ${user.id} and provider = 'demo'`;
  if (!o) return fail('Order not found.', 404);

  try {
    await fulfilOrder(b.orderId, { provider: 'demo' });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof OrderError) return fail(e.message, 409);
    throw e;
  }
}

import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { getCashfreePayment } from '@/lib/cashfree';
import { confirmCashfree } from '@/lib/confirm';
import { reportError } from '@/lib/errors';

// Called by the checkout screen after the Cashfree popup closes.
// We never trust the browser: we ask Cashfree whether the order is PAID.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in.', 401);
  const b = await body<{ orderId?: string }>(req);
  if (!b || !isUuid(b.orderId)) return fail('Missing order.');
  const [o] = await sql`select 1 from orders where id = ${b.orderId} and user_id = ${user.id} and provider = 'cashfree'`;
  if (!o) return fail('Order not found.', 404);
  try {
    const p = await getCashfreePayment(b.orderId);
    if (!p.paid) return json({ paid: false });
    const r = await confirmCashfree(b.orderId, p);
    return r.ok ? json({ paid: true }) : fail(r.error, 409);
  } catch (e) {
    await reportError(e, 'cashfree verify');
    return fail('Couldn’t check the payment yet. If money was taken, your ticket appears within a few minutes.', 502);
  }
}

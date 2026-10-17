import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { fulfilOrder, OrderError } from '@/lib/orders';
import { activeGateway } from '@/lib/payments';
import { notifyOrderPaid } from '@/lib/mail';
import { afterResponse } from '@/lib/errors';

// Demo checkout — only when DEMO_PAYMENTS=1, no gateway keys are set, and we are NOT in production
// (see activeGateway). Otherwise it answers 404, as if it didn't exist.
export async function POST(req: Request) {
  if (activeGateway() !== 'demo') return fail('Not found.', 404);
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in.', 401);

  const b = await body<{ orderId?: string }>(req);
  if (!b || !isUuid(b.orderId)) return fail('Missing order.');
  const [o] = await sql`select 1 from orders where id = ${b.orderId} and user_id = ${user.id} and provider = 'demo' and method = 'gateway'`;
  if (!o) return fail('Order not found.', 404);

  try {
    const r = await fulfilOrder(b.orderId, { provider: 'demo' });
    if (!r.already) await afterResponse('ticket email', () => notifyOrderPaid(b.orderId!));
    return json({ ok: true });
  } catch (e) {
    if (e instanceof OrderError) return fail(e.message, 409);
    throw e;
  }
}

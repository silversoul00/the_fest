import { getUser } from '@/lib/auth';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { cancelOrder } from '@/lib/orders';

// User closed the payment window — release the held seats right away.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in.', 401);
  const b = await body<{ orderId?: string }>(req);
  if (!b || !isUuid(b.orderId)) return fail('Missing order.');
  await cancelOrder(b.orderId, user.id);
  return json({ ok: true });
}

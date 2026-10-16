import { getUser } from '@/lib/auth';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { OrderError } from '@/lib/orders';
import { submitUtr } from '@/lib/upi';

// Student pastes the 12-digit UPI reference (UTR) after paying the fest by UPI.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in.', 401);
  const b = await body<{ orderId?: string; utr?: string }>(req);
  if (!b || !isUuid(b.orderId) || !b.utr) return fail('Enter the UTR from your UPI app.');
  try {
    return json(await submitUtr(b.orderId, user.id, String(b.utr)));
  } catch (e) {
    if (e instanceof OrderError) return fail(e.message, 409);
    throw e;
  }
}

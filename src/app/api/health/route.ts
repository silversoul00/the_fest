import { sql } from '@/lib/db';
import { json } from '@/lib/http';
import { razorpayEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await sql`select 1`;
    return json({ status: 'ok', db: 'up', payments: razorpayEnabled() ? 'razorpay' : 'demo', signing: !!process.env.TICKET_PRIVATE_KEY });
  } catch {
    return json({ status: 'degraded', db: 'down' }, 503);
  }
}

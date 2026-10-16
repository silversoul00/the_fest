import { sql } from '@/lib/db';
import { json } from '@/lib/http';
import { activeGateway } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await sql`select 1`;
    return json({ status: 'ok', db: 'up', payments: activeGateway(), email: process.env.RESEND_API_KEY ? 'resend' : 'logged', signing: !!process.env.TICKET_PRIVATE_KEY });
  } catch {
    return json({ status: 'degraded', db: 'down' }, 503);
  }
}

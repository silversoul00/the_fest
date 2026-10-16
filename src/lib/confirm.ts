import 'server-only';
import { sql } from './db';
import { fulfilOrder, OrderError } from './orders';
import { notifyOrderPaid } from './mail';

/** Confirm a Cashfree order after Cashfree itself says it is PAID. Checks the amount too. */
export async function confirmCashfree(orderId: string, p: { paid: boolean; paymentId?: string; amountPaise?: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!p.paid) return { ok: false, error: 'Not paid.' };
  const [o] = await sql<{ amount_paise: number; status: string }[]>`select amount_paise, status from orders where id = ${orderId}`;
  if (!o) return { ok: false, error: 'Order not found.' };
  if (o.status === 'paid') return { ok: true };
  if (p.amountPaise !== undefined && p.amountPaise !== o.amount_paise) {
    await sql`update orders set review_flag = ${`Cashfree amount ₹${p.amountPaise / 100} ≠ order ₹${o.amount_paise / 100}`} where id = ${orderId}`;
    return { ok: false, error: 'Payment amount didn’t match. The organizer has been alerted.' };
  }
  try {
    const r = await fulfilOrder(orderId, { provider: 'cashfree', paymentId: p.paymentId });
    if (!r.already) notifyOrderPaid(orderId).catch(() => {});
    return { ok: true };
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message };
    throw e;
  }
}

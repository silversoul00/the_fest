import 'server-only';
import { sql } from './db';
import { OrderError } from './orders';
import { cashfreeRefundedTotal, cashfreeRefundId, refundCashfree } from './cashfree';
import { razorpayRefundedTotal, refundRazorpay } from './payments';
import { notifyRefund } from './mail';

/**
 * Cancel unused tickets in an order and refund their share of what the student paid
 * (ticket price + convenience fee + payment charges — the student gets everything back).
 * • Cashfree / Razorpay: refund is sent through the gateway automatically.
 * • Zero-fee bank UPI: marked "manual_pending" — the organizer sends the money back by UPI.
 * • Demo / free: nothing to send.
 * Checked-in (used) tickets can't be refunded.
 */
export async function refundOrder(orderId: string, opts: { festId: string; tickets?: number; reason: string; releaseSeats?: boolean }) {
  const res = await sql.begin(async (tx) => {
    const [o] = await tx<{ id: string; qty: number; amount_paise: number; refunded_paise: number; platform_fee_paise: number; gateway_fee_paise: number; provider: string; status: string; ticket_type_id: string; payment_ref: string | null; razorpay_payment_id: string | null }[]>`
      select id, qty, amount_paise, refunded_paise, platform_fee_paise, gateway_fee_paise, provider, status, ticket_type_id, payment_ref, razorpay_payment_id
      from orders where id = ${orderId} and fest_id = ${opts.festId} for update`;
    if (!o) throw new OrderError('Order not found.');
    if (o.status !== 'paid') throw new OrderError('Only paid orders can be refunded.');

    const unused = await tx<{ id: string }[]>`
      select id from tickets where order_id = ${orderId} and status = 'valid' order by issued_at for update`;
    const k = Math.min(opts.tickets ?? unused.length, unused.length);
    if (k <= 0) throw new OrderError('All tickets in this order were already used or cancelled.');

    const share = (v: number) => Math.round((v * k) / o.qty);
    const amount = Math.min(share(o.amount_paise), o.amount_paise - o.refunded_paise);
    const ids = unused.slice(0, k).map((t) => t.id);
    await tx`update tickets set status = 'void', void_reason = ${('Cancelled: ' + opts.reason).slice(0, 200)} where id in ${tx(ids)}`;

    const [{ left }] = await tx<{ left: number }[]>`select count(*)::int as left from tickets where order_id = ${orderId} and status in ('valid', 'used')`;
    const refundStatus = o.provider === 'upi_direct' ? 'manual_pending' : o.provider === 'cashfree' || o.provider === 'razorpay' ? 'processing' : 'done';
    await tx`update orders set
        refunded_paise = refunded_paise + ${amount},
        platform_fee_paise = greatest(platform_fee_paise - ${share(o.platform_fee_paise)}, 0),
        gateway_fee_paise = greatest(gateway_fee_paise - ${share(o.gateway_fee_paise)}, 0),
        status = ${left === 0 ? 'refunded' : 'paid'}::order_status,
        refunded_at = now(),
        -- an earlier failed gateway refund stays visible until it's retried
        refund_status = case when refund_failed_paise > 0 then 'failed' else ${refundStatus} end,
        refund_note = ${opts.reason.slice(0, 200)}
      where id = ${orderId}`;
    if (opts.releaseSeats !== false) await tx`update ticket_types set sold = greatest(sold - ${k}, 0) where id = ${o.ticket_type_id}`;
    return { amount, k, provider: o.provider, refundedAfter: o.refunded_paise + amount, paymentId: o.provider === 'razorpay' ? o.razorpay_payment_id : o.payment_ref };
  });

  // Money movement happens after the database is updated; failures are flagged for retry.
  let gatewayOk = true;
  if (res.amount > 0 && (res.provider === 'cashfree' || res.provider === 'razorpay')) {
    try {
      if (res.provider === 'cashfree') await refundCashfree(orderId, res.amount, cashfreeRefundId(orderId, res.refundedAfter), 'Ticket cancelled');
      else if (res.paymentId) await refundRazorpay(res.paymentId, res.amount, 'Ticket cancelled');
      else throw new Error('No payment id');
      await sql`update orders set refund_status = case when refund_failed_paise > 0 then 'failed' else 'done' end where id = ${orderId}`;
    } catch (e) {
      gatewayOk = false;
      console.error('gateway refund failed', orderId, e);
      await sql`update orders set refund_status = 'failed', refund_failed_paise = refund_failed_paise + ${res.amount}, review_flag = ${'Refund failed at payment gateway — retry from admin'} where id = ${orderId}`;
    }
  }
  if (res.amount > 0) notifyRefund(orderId, res.amount, opts.reason).catch(() => {});
  return { ...res, gatewayOk };
}

/** Cancel a whole fest: stop sales and refund every paid order's unused tickets. */
export async function cancelFest(festId: string, reason: string) {
  await sql`update fests set status = 'cancelled', cancelled_reason = ${reason.slice(0, 300)} where id = ${festId}`;
  const orders = await sql<{ id: string }[]>`select id from orders where fest_id = ${festId} and status = 'paid'`;
  let refunded = 0, failed = 0, skipped = 0;
  for (const o of orders) {
    try {
      const r = await refundOrder(o.id, { festId, reason: `Fest cancelled — ${reason}`, releaseSeats: false });
      if (r.gatewayOk) refunded++; else failed++;
    } catch {
      skipped++; // e.g. every ticket already used
    }
  }
  // Pending checkouts can't complete any more. Bank-UPI orders where the student already
  // entered a UTR may have paid — flag them so the organizer checks and sends money back.
  await sql`update orders set status = 'failed',
              review_flag = case when utr is not null then 'Fest cancelled — if this UPI payment arrived, send it back' else review_flag end
            where fest_id = ${festId} and status = 'pending'`;
  return { refunded, failed, skipped, total: orders.length };
}

/**
 * Admin: retry a gateway refund that failed earlier.
 * The order is claimed atomically (two clicks can't both send money), and the gateway is asked
 * how much it has already refunded first — a refund that "failed" on our side but actually went
 * through is not sent again.
 */
export async function retryRefund(orderId: string) {
  const [o] = await sql<{ provider: string; refunded_paise: number; refund_failed_paise: number; razorpay_payment_id: string | null }[]>`
    update orders set refund_status = 'processing'
    where id = ${orderId} and refund_status = 'failed' and refund_failed_paise > 0
    returning provider, refunded_paise, refund_failed_paise, razorpay_payment_id`;
  if (!o) throw new OrderError('Nothing to retry (or a retry is already running).');
  try {
    let already: number;
    if (o.provider === 'cashfree') already = await cashfreeRefundedTotal(orderId);
    else if (o.provider === 'razorpay' && o.razorpay_payment_id) already = await razorpayRefundedTotal(o.razorpay_payment_id);
    else throw new OrderError('This payment can’t be refunded through a gateway.');
    const due = Math.min(o.refund_failed_paise, o.refunded_paise - already);
    if (due > 0) {
      if (o.provider === 'cashfree') await refundCashfree(orderId, due, cashfreeRefundId(orderId, o.refunded_paise), 'Ticket cancelled');
      else await refundRazorpay(o.razorpay_payment_id!, due, 'Ticket cancelled');
    }
    await sql`update orders set refund_status = 'done', refund_failed_paise = 0, review_flag = null where id = ${orderId}`;
    return { sent: Math.max(due, 0) };
  } catch (e) {
    await sql`update orders set refund_status = 'failed' where id = ${orderId} and refund_status = 'processing'`;
    throw e;
  }
}

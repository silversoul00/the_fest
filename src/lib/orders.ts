import 'server-only';
import type postgres from 'postgres';
import { sql } from './db';
import { feeConfig } from './payments';
import { quote, type Method } from './pricing';
import { ticketCode } from './ticket-crypto';
import { todayIST } from './format';

const HOLD_MINUTES = 15;        // card/gateway checkout
const UPI_HOLD_MINUTES = 30;    // bank UPI: time to pay and paste the UTR

export class OrderError extends Error {}

export type Provider = 'razorpay' | 'cashfree' | 'demo' | 'free' | 'upi_direct';

/**
 * Reserve inventory and create a pending order.
 * Seats are held while the student pays. Expired holds are released inside the
 * same row lock so abandoned checkouts never block sales — except bank-UPI
 * orders where the student has already submitted a UTR (money may have left
 * their account); those wait for verification or an organizer's decision.
 */
export async function createOrder(input: { userId: string; ticketTypeId: string; qty: number; method?: Method }) {
  const { userId, ticketTypeId, qty } = input;
  const method: Method = input.method ?? 'gateway';
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new OrderError('Choose between 1 and 10 tickets.');

  return sql.begin(async (tx) => {
    const [tt] = await tx<{ id: string; fest_id: string; price_paise: number; quota: number; sold: number; active: boolean; status: string; capacity: number | null; ends_on: string; name: string; upi_enabled: boolean; upi_vpa: string | null }[]>`
      select tt.id, tt.fest_id, tt.price_paise, tt.quota, tt.sold, tt.active, tt.name,
             f.status, f.capacity, f.ends_on, f.upi_enabled, f.upi_vpa
      from ticket_types tt join fests f on f.id = tt.fest_id
      where tt.id = ${ticketTypeId}
      for update of tt`;
    if (!tt) throw new OrderError('Ticket type not found.');
    if (tt.status !== 'live' || !tt.active) throw new OrderError('Tickets are not on sale right now.');
    if (tt.ends_on < todayIST()) throw new OrderError('This fest has ended.');
    if (method === 'upi_direct' && tt.price_paise > 0 && !(tt.upi_enabled && tt.upi_vpa)) {
      throw new OrderError('This fest does not accept direct UPI. Choose card/UPI checkout.');
    }

    const released = await releaseExpiredHolds(tx, ticketTypeId);
    const sold = tt.sold - released;

    if (sold + qty > tt.quota) {
      if (released) await tx`update ticket_types set sold = ${sold} where id = ${ticketTypeId}`;
      const left = tt.quota - sold;
      throw new OrderError(left <= 0 ? `${tt.name} is sold out.` : `Only ${left} left for ${tt.name}.`);
    }

    // Per-student limit: 10 tickets per fest
    const [{ owned }] = await tx<{ owned: number }[]>`
      select coalesce(sum(qty), 0)::int as owned from orders
      where user_id = ${userId} and fest_id = ${tt.fest_id} and status in ('paid', 'pending')`;
    if (owned + qty > 10) throw new OrderError('You can hold at most 10 tickets for one fest.');

    // Fest-wide capacity across all ticket types
    if (tt.capacity) {
      const [{ total }] = await tx<{ total: number }[]>`
        select coalesce(sum(sold), 0)::int as total from ticket_types where fest_id = ${tt.fest_id}`;
      if (total - released + qty > tt.capacity) throw new OrderError('The fest has reached full capacity.');
    }

    await tx`update ticket_types set sold = ${sold + qty} where id = ${ticketTypeId}`;

    const q = quote(tt.price_paise, qty, feeConfig(), method);
    let amount = q.total;
    const free = q.total === 0;

    if (!free && method === 'upi_direct') {
      // Tag the amount with a few paise so each open UPI order has a unique
      // amount (₹270.37). Lets the app match bank credits even if the student
      // mistypes the UTR. Fest-level lock prevents two orders picking the same tag.
      // A tag stays reserved for 7 days whatever happened to the order, so a late or
      // repeated bank alert for an old order can never match a newer one. Max ₹9.99 extra.
      await tx`select pg_advisory_xact_lock(hashtext(${tt.fest_id}))`;
      const taken = new Set((await tx<{ a: number }[]>`
        select amount_paise as a from orders
        where fest_id = ${tt.fest_id} and method = 'upi_direct'
          and created_at > now() - interval '7 days'`).map((r) => r.a));
      let k = 1;
      while (taken.has(amount + k) && k <= 999) k++;
      if (k > 999) throw new OrderError('Too many UPI payments at this price this week. Use card/UPI checkout.');
      amount += k;
    }

    const provider: Provider = free ? 'free' : method === 'upi_direct' ? 'upi_direct' : 'demo';
    const [order] = await tx<{ id: string }[]>`
      insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, gateway_fee_paise, provider, method)
      values (${userId}, ${tt.fest_id}, ${ticketTypeId}, ${qty}, ${amount}, ${q.fee}, ${q.gatewayFee}, ${provider},
              ${free ? 'free' : method})
      returning id`;
    return { orderId: order.id, amount, fee: q.fee, gatewayFee: q.gatewayFee, festId: tt.fest_id, free, upiVpa: tt.upi_vpa };
  });
}

/** Release this ticket type's expired holds; returns seats freed. */
async function releaseExpiredHolds(tx: postgres.TransactionSql, ticketTypeId: string) {
  const expired = await tx<{ qty: number }[]>`
    update orders set status = 'failed'
    where ticket_type_id = ${ticketTypeId} and status = 'pending'
      and (
        (method <> 'upi_direct' and created_at < now() - make_interval(mins => ${HOLD_MINUTES}))
        or (method = 'upi_direct' and utr is null and created_at < now() - make_interval(mins => ${UPI_HOLD_MINUTES}))
      )
    returning qty`;
  return expired.reduce((a, r) => a + r.qty, 0);
}

/**
 * Mark an order paid and issue its tickets. Idempotent: calling it twice
 * (checkout callback + webhook, or two matching bank credits) issues tickets once.
 */
export async function fulfilOrder(orderId: string, payment?: { provider: Provider; paymentId?: string; verifySource?: string }) {
  const res = await sql.begin(async (tx) => {
    const [o] = await tx<{ id: string; user_id: string; fest_id: string; ticket_type_id: string; qty: number; status: string }[]>`
      select id, user_id, fest_id, ticket_type_id, qty, status from orders where id = ${orderId} for update`;
    if (!o) throw new OrderError('Order not found.');
    if (o.status === 'paid') return { issued: 0, already: true };
    if (o.status === 'refunded') throw new OrderError('Order was refunded.');

    // Money arrived but no ticket can be issued: keep the order unpaid, remember the payment,
    // and flag it for a refund. (Returned, not thrown, so the flag is actually saved.)
    const needsRefund = async (reason: string) => {
      await tx`update orders set review_flag = ${reason},
                 payment_ref = coalesce(${payment?.paymentId ?? null}, payment_ref),
                 verify_source = coalesce(${payment?.verifySource ?? null}, verify_source)
               where id = ${orderId}`;
      return { refundNeeded: reason };
    };

    // Share-lock the fest so a cancellation can't slip in between this check and the tickets.
    const [f] = await tx<{ status: string }[]>`select status from fests where id = ${o.fest_id} for share`;
    if (f.status === 'cancelled') return needsRefund('Paid after the fest was cancelled — refund needed');

    if (o.status === 'failed') {
      // Hold expired before payment landed — re-reserve if seats remain, else it needs a refund
      const [tt] = await tx<{ sold: number; quota: number }[]>`select sold, quota from ticket_types where id = ${o.ticket_type_id} for update`;
      if (tt.sold + o.qty > tt.quota) return needsRefund('Paid after seats sold out — refund needed');
      await tx`update ticket_types set sold = sold + ${o.qty} where id = ${o.ticket_type_id}`;
    }

    const provider = payment?.provider ?? 'demo';
    await tx`update orders set status = 'paid', paid_at = now(), provider = ${provider},
              payment_ref = coalesce(${payment?.paymentId ?? null}, payment_ref),
              razorpay_payment_id = ${provider === 'razorpay' ? payment?.paymentId ?? null : null},
              verify_source = coalesce(${payment?.verifySource ?? null}, verify_source),
              review_flag = null
            where id = ${orderId}`;

    const [u] = await tx<{ name: string }[]>`select name from users where id = ${o.user_id}`;
    for (let i = 0; i < o.qty; i++) {
      await tx`insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name)
               values (${ticketCode()}, ${o.id}, ${o.user_id}, ${o.fest_id}, ${o.ticket_type_id},
                       ${o.qty > 1 ? `${u.name} (${i + 1}/${o.qty})` : u.name})`;
    }
    return { issued: o.qty, already: false, userId: o.user_id, festId: o.fest_id };
  });
  if ('refundNeeded' in res) throw new OrderError(res.refundNeeded as string);
  return res;
}

/** Mark a pending order failed and release its seats (user cancelled checkout). */
export async function cancelOrder(orderId: string, userId: string) {
  await sql.begin(async (tx) => {
    const [o] = await tx<{ qty: number; ticket_type_id: string }[]>`
      update orders set status = 'failed'
      where id = ${orderId} and user_id = ${userId} and status = 'pending' and utr is null
      returning qty, ticket_type_id`;
    if (o) await tx`update ticket_types set sold = greatest(sold - ${o.qty}, 0) where id = ${o.ticket_type_id}`;
  });
}

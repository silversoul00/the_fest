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
export async function createOrder(input: { userId: string; ticketTypeId: string; qty: number; method?: Method; ticketId?: string }) {
  const { userId, ticketTypeId } = input;
  let qty = input.qty;
  const method: Method = input.method ?? 'gateway';
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new OrderError('Choose between 1 and 10 tickets.');

  return sql.begin(async (tx) => {
    const [tt] = await tx<{ id: string; fest_id: string; price_paise: number; quota: number; sold: number; active: boolean; status: string; capacity: number | null; ends_on: string; name: string; upi_enabled: boolean; upi_vpa: string | null; kind: string }[]>`
      select tt.id, tt.fest_id, tt.price_paise, tt.quota, tt.sold, tt.active, tt.name, tt.kind,
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

    // Add-ons (lunch / stay) attach to one ticket the buyer holds for this fest: one per ticket, no new ticket, no seat.
    let addonFor: string | null = null;
    if (tt.kind === 'addon') {
      if (!input.ticketId) throw new OrderError('Add-ons are bought from your ticket page.');
      const [t] = await tx<{ id: string }[]>`
        select id from tickets where id = ${input.ticketId} and user_id = ${userId} and fest_id = ${tt.fest_id} and status <> 'void'
        for update`;
      if (!t) throw new OrderError('Pick one of your valid tickets for this fest.');
      const [dup] = await tx`select 1 from orders where addon_for = ${t.id} and ticket_type_id = ${ticketTypeId} and status in ('paid', 'pending')`;
      if (dup) throw new OrderError(`This ticket already has ${tt.name}.`);
      addonFor = t.id;
      qty = 1;
    }

    const released = await releaseExpiredHolds(tx, ticketTypeId);
    const sold = tt.sold - released;

    if (sold + qty > tt.quota) {
      if (released) await tx`update ticket_types set sold = ${sold} where id = ${ticketTypeId}`;
      const left = tt.quota - sold;
      throw new OrderError(left <= 0 ? `${tt.name} is sold out.` : `Only ${left} left for ${tt.name}.`);
    }

    // Per-student limit: 10 tickets per fest (add-ons aren't tickets)
    const [{ owned }] = await tx<{ owned: number }[]>`
      select coalesce(sum(qty), 0)::int as owned from orders
      where user_id = ${userId} and fest_id = ${tt.fest_id} and status in ('paid', 'pending') and addon_for is null`;
    if (!addonFor && owned + qty > 10) throw new OrderError('You can hold at most 10 tickets for one fest.');

    // Fest-wide capacity across all entry ticket types (add-ons don't take a seat)
    if (tt.capacity && !addonFor) {
      const [{ total }] = await tx<{ total: number }[]>`
        select coalesce(sum(sold), 0)::int as total from ticket_types where fest_id = ${tt.fest_id} and kind = 'entry'`;
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
      // A tag stays reserved for 7 days while the order is open or expired (a late payment can
      // still arrive), and for 1 day after it's paid (repeat alerts for the same payment), so an
      // old alert can never match a newer order. Max ₹19.99 extra.
      await tx`select pg_advisory_xact_lock(hashtext(${tt.fest_id}))`;
      const taken = new Set((await tx<{ a: number }[]>`
        select amount_paise as a from orders
        where fest_id = ${tt.fest_id} and method = 'upi_direct'
          and created_at > now() - interval '7 days'
          and (status not in ('paid', 'refunded') or paid_at > now() - interval '1 day')`).map((r) => r.a));
      let k = 1;
      while (taken.has(amount + k) && k <= 1999) k++;
      if (k > 1999) throw new OrderError('Too many UPI payments at this price right now. Use card/UPI checkout.');
      amount += k;
    }

    const provider: Provider = free ? 'free' : method === 'upi_direct' ? 'upi_direct' : 'demo';
    const [order] = await tx<{ id: string }[]>`
      insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, gateway_fee_paise, provider, method, addon_for)
      values (${userId}, ${tt.fest_id}, ${ticketTypeId}, ${qty}, ${amount}, ${q.fee}, ${q.gatewayFee}, ${provider},
              ${free ? 'free' : method}, ${addonFor})
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
    const [o] = await tx<{ id: string; user_id: string; fest_id: string; ticket_type_id: string; qty: number; status: string; addon_for: string | null }[]>`
      select id, user_id, fest_id, ticket_type_id, qty, status, addon_for from orders where id = ${orderId} for update`;
    if (!o) throw new OrderError('Order not found.');
    if (o.status === 'paid') return { issued: 0, already: true };
    if (o.status === 'refunded') throw new OrderError('Order was refunded.');

    // Money arrived but no ticket can be issued: keep the order unpaid, remember the payment,
    // and flag it for a refund. (Returned, not thrown, so the flag is actually saved.)
    const needsRefund = async (reason: string) => {
      const upi = payment?.provider === 'upi_direct';
      await tx`update orders set review_flag = ${reason},
                 provider = coalesce(${payment?.provider ?? null}, provider),
                 payment_ref = coalesce(${payment?.paymentId ?? null}, payment_ref),
                 razorpay_payment_id = case when ${payment?.provider ?? null} = 'razorpay' then ${payment?.paymentId ?? null} else razorpay_payment_id end,
                 verify_source = coalesce(${payment?.verifySource ?? null}, verify_source),
                 -- bank UPI: the money is in the fest's account, so it goes on the organizer's send-back list
                 refunded_paise = case when ${upi} then amount_paise else refunded_paise end,
                 refund_status = case when ${upi} then 'manual_pending' else refund_status end,
                 refunded_at = case when ${upi} then now() else refunded_at end,
                 refund_note = case when ${upi} then ${reason} else refund_note end
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

    // Add-on: the perk rides on the existing ticket (its QR doesn't change) — no new ticket rows.
    if (o.addon_for) return { issued: 0, already: false, userId: o.user_id, festId: o.fest_id };

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

import 'server-only';
import type postgres from 'postgres';
import { sql } from './db';
import { eventFees, feeConfig } from './payments';
import { quote, type Method } from './pricing';
import { ticketCode } from './ticket-crypto';
import { todayIST } from './format';
import { checkEntryMembers } from './events';
import { eventsReady } from './fest-access';

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
export async function createOrder(input: { userId: string; ticketTypeId: string; qty: number; method?: Method; ticketId?: string; registrationId?: string }) {
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

    const released = await releaseExpiredHolds(tx, ticketTypeId);
    const sold = tt.sold - released;

    // Add-ons (lunch / stay) attach to one ticket the buyer holds for this fest: one per ticket, no new ticket, no seat.
    // Checked after expired holds are released, so an abandoned checkout doesn't block buying it again.
    let addonFor: string | null = null;
    if (tt.kind === 'addon') {
      if (!input.ticketId) throw new OrderError('Add-ons are bought from your ticket page.');
      const [t] = await tx<{ id: string }[]>`
        select id from tickets where id = ${input.ticketId} and user_id = ${userId} and fest_id = ${tt.fest_id} and status <> 'void'
        for update`;
      if (!t) throw new OrderError('Pick one of your valid tickets for this fest.');
      const [dup] = await tx`select 1 from orders where addon_for = ${t.id} and ticket_type_id = ${ticketTypeId} and status in ('paid', 'pending')`;
      if (dup) {
        if (released) await tx`update ticket_types set sold = ${sold} where id = ${ticketTypeId}`;
        throw new OrderError(`This ticket already has ${tt.name}.`);
      }
      addonFor = t.id;
      qty = 1;
    }

    // v2.8 event entry (one order per team, paid by the captain): the shadow ticket type is the slot counter.
    // Lock order everywhere: shadow ticket_types row (above) → event_regs row.
    let registrationId: string | null = null;
    if (tt.kind === 'event' || input.registrationId) {
      const undo = async () => { if (released) await tx`update ticket_types set sold = ${sold} where id = ${ticketTypeId}`; };
      if (tt.kind !== 'event' || !input.registrationId) { await undo(); throw new OrderError('Register from the event page.'); }
      const [r] = await tx<{ id: string; captain_id: string; status: string; team_min: number; deadline: Date; active: boolean }[]>`
        select r.id, r.captain_id, r.status, e.team_min, e.reg_deadline as deadline, e.active
        from event_regs r join events e on e.id = r.event_id
        where r.id = ${input.registrationId} and e.ticket_type_id = ${ticketTypeId}
        for update of r`;
      const fail = async (m: string) => { await undo(); throw new OrderError(m); };
      if (!r || r.captain_id !== userId) return fail('Only the team captain can pay for this entry.');
      if (r.status !== 'forming') return fail(r.status === 'confirmed' ? 'This entry is already confirmed.' : 'This entry was withdrawn.');
      if (!r.active) return fail('This event is not taking entries.');
      if (r.deadline.getTime() <= Date.now()) return fail('Registration for this event has closed.');
      const problem = await checkEntryMembers(tx, r.id);
      if (problem) return fail(problem);
      const [{ joined }] = await tx<{ joined: number }[]>`select count(*)::int joined from event_members where reg_id = ${r.id} and status = 'joined'`;
      if (joined < r.team_min) return fail(`Your team needs at least ${r.team_min} members before paying.`);
      const [open] = await tx`select 1 from orders where registration_id = ${r.id} and status in ('pending', 'paid')`;
      if (open) return fail('A payment for this entry is already in progress.');
      registrationId = r.id;
      qty = 1;
    }

    if (sold + qty > tt.quota) {
      if (released) await tx`update ticket_types set sold = ${sold} where id = ${ticketTypeId}`;
      const left = tt.quota - sold;
      if (registrationId) throw new OrderError('This event is full.');
      throw new OrderError(left <= 0 ? `${tt.name} is sold out.` : `Only ${left} left for ${tt.name}.`);
    }

    // Per-student limit: 10 tickets per fest (add-ons and event entries aren't tickets)
    const [{ owned }] = await tx<{ owned: number }[]>`
      select coalesce(sum(qty), 0)::int as owned from orders
      where user_id = ${userId} and fest_id = ${tt.fest_id} and status in ('paid', 'pending') and addon_for is null ${(await eventsReady()) ? tx`and registration_id is null` : tx``}`;
    if (!addonFor && !registrationId && owned + qty > 10) throw new OrderError('You can hold at most 10 tickets for one fest.');

    // Fest-wide capacity across all entry ticket types (add-ons and event entries don't take a seat)
    if (tt.capacity && !addonFor && !registrationId) {
      const [{ total }] = await tx<{ total: number }[]>`
        select coalesce(sum(sold), 0)::int as total from ticket_types where fest_id = ${tt.fest_id} and kind = 'entry'`;
      if (total - released + qty > tt.capacity) throw new OrderError('The fest has reached full capacity.');
    }

    await tx`update ticket_types set sold = ${sold + qty} where id = ${ticketTypeId}`;

    const q = quote(tt.price_paise, qty, registrationId ? eventFees() : feeConfig(), method);
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
      insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, gateway_fee_paise, provider, method, addon_for
                          ${registrationId ? tx`, registration_id` : tx``})
      values (${userId}, ${tt.fest_id}, ${ticketTypeId}, ${qty}, ${amount}, ${q.fee}, ${q.gatewayFee}, ${provider},
              ${free ? 'free' : method}, ${addonFor} ${registrationId ? tx`, ${registrationId}` : tx``})
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
    const [o] = await tx<{ id: string; user_id: string; fest_id: string; ticket_type_id: string; qty: number; status: string; addon_for: string | null; registration_id: string | null }[]>`
      select * from orders where id = ${orderId} for update`;  // * : registration_id exists only from v2.8
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

    // Add-on: pay only once per ticket, and only while the ticket is still valid (a late payment after a re-buy,
    // or a ticket cancelled/transferred while paying, goes on the refund list instead).
    if (o.addon_for) {
      const [t] = await tx<{ status: string }[]>`select status from tickets where id = ${o.addon_for}`;
      if (!t || t.status === 'void') return needsRefund('Add-on paid for a cancelled ticket — refund needed');
      const [dup] = await tx`select 1 from orders where addon_for = ${o.addon_for} and ticket_type_id = ${o.ticket_type_id} and status = 'paid' and id <> ${o.id}`;
      if (dup) return needsRefund('Add-on already on this ticket — refund needed');
    }

    // v2.8 event entry: confirm the team once. Locks the shadow type, then the entry (same order as createOrder).
    if (o.registration_id) {
      await tx`select 1 from ticket_types where id = ${o.ticket_type_id} for update`;
      const [r] = await tx<{ status: string }[]>`select status from event_regs where id = ${o.registration_id} for update`;
      if (!r || r.status === 'withdrawn' || r.status === 'refunded') return needsRefund('Paid for a withdrawn event entry — refund needed');
      if (r.status === 'confirmed') return needsRefund('Event entry was already paid — refund needed');
      const [other] = await tx`select 1 from orders where registration_id = ${o.registration_id} and id <> ${o.id} and status in ('pending', 'paid')`;
      if (other) return needsRefund('Another payment for this event entry is open — refund needed');
    }

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

    // Event entry: the team is in — no ticket rows.
    if (o.registration_id) {
      await tx`update event_regs set status = 'confirmed', confirmed_at = now() where id = ${o.registration_id}`;
      return { issued: 0, already: false, userId: o.user_id, festId: o.fest_id };
    }
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

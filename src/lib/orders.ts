import 'server-only';
import { sql } from './db';
import { priceOrder } from './payments';
import { ticketCode } from './ticket-crypto';
import { todayIST } from './format';

const HOLD_MINUTES = 15;

export class OrderError extends Error {}

/**
 * Reserve inventory and create a pending order.
 * Seats are held for 15 minutes; expired pending orders are released
 * (inside the same row lock) so abandoned checkouts don't block sales.
 */
export async function createOrder(input: { userId: string; ticketTypeId: string; qty: number }) {
  const { userId, ticketTypeId, qty } = input;
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new OrderError('Choose between 1 and 10 tickets.');

  return sql.begin(async (tx) => {
    const [tt] = await tx<{ id: string; fest_id: string; price_paise: number; quota: number; sold: number; active: boolean; status: string; capacity: number | null; ends_on: string; name: string }[]>`
      select tt.id, tt.fest_id, tt.price_paise, tt.quota, tt.sold, tt.active, tt.name,
             f.status, f.capacity, f.ends_on
      from ticket_types tt join fests f on f.id = tt.fest_id
      where tt.id = ${ticketTypeId}
      for update of tt`;
    if (!tt) throw new OrderError('Ticket type not found.');
    if (tt.status !== 'live' || !tt.active) throw new OrderError('Tickets are not on sale right now.');
    if (tt.ends_on < todayIST()) throw new OrderError('This fest has ended.');

    // Release this ticket type's expired holds
    const expired = await tx<{ qty: number }[]>`
      update orders set status = 'failed'
      where ticket_type_id = ${ticketTypeId} and status = 'pending'
        and created_at < now() - make_interval(mins => ${HOLD_MINUTES})
      returning qty`;
    const released = expired.reduce((a, r) => a + r.qty, 0);
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

    const { total, fee } = priceOrder(tt.price_paise, qty);
    const provider = total === 0 ? 'free' : 'pending-provider';
    const [order] = await tx<{ id: string }[]>`
      insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, provider)
      values (${userId}, ${tt.fest_id}, ${ticketTypeId}, ${qty}, ${total}, ${fee}, ${provider === 'free' ? 'free' : 'demo'})
      returning id`;
    return { orderId: order.id, amount: total, fee, festId: tt.fest_id, free: total === 0 };
  });
}

/**
 * Mark an order paid and issue its tickets. Idempotent: calling it twice
 * (checkout callback + webhook) issues tickets only once.
 */
export async function fulfilOrder(orderId: string, payment?: { provider: 'razorpay' | 'demo' | 'free'; paymentId?: string }) {
  return sql.begin(async (tx) => {
    const [o] = await tx<{ id: string; user_id: string; fest_id: string; ticket_type_id: string; qty: number; status: string }[]>`
      select id, user_id, fest_id, ticket_type_id, qty, status from orders where id = ${orderId} for update`;
    if (!o) throw new OrderError('Order not found.');
    if (o.status === 'paid') return { issued: 0, already: true };

    if (o.status === 'failed') {
      // Hold expired before payment landed — re-reserve if seats remain, else it needs a refund
      const [tt] = await tx<{ sold: number; quota: number }[]>`select sold, quota from ticket_types where id = ${o.ticket_type_id} for update`;
      if (tt.sold + o.qty > tt.quota) throw new OrderError('Payment received after seats sold out — refund required.');
      await tx`update ticket_types set sold = sold + ${o.qty} where id = ${o.ticket_type_id}`;
    }

    await tx`update orders set status = 'paid', paid_at = now(),
              provider = ${payment?.provider ?? 'demo'},
              razorpay_payment_id = ${payment?.paymentId ?? null}
            where id = ${orderId}`;

    const [u] = await tx<{ name: string }[]>`select name from users where id = ${o.user_id}`;
    for (let i = 0; i < o.qty; i++) {
      await tx`insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name)
               values (${ticketCode()}, ${o.id}, ${o.user_id}, ${o.fest_id}, ${o.ticket_type_id},
                       ${o.qty > 1 ? `${u.name} (${i + 1}/${o.qty})` : u.name})`;
    }
    return { issued: o.qty, already: false };
  });
}

/** Mark a pending order failed and release its seats (user cancelled checkout). */
export async function cancelOrder(orderId: string, userId: string) {
  await sql.begin(async (tx) => {
    const [o] = await tx<{ qty: number; ticket_type_id: string }[]>`
      update orders set status = 'failed'
      where id = ${orderId} and user_id = ${userId} and status = 'pending'
      returning qty, ticket_type_id`;
    if (o) await tx`update ticket_types set sold = greatest(sold - ${o.qty}, 0) where id = ${o.ticket_type_id}`;
  });
}

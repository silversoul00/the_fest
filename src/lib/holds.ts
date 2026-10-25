import 'server-only';
import type postgres from 'postgres';

/*
 * Checkout holds (tickets, add-ons and v2.8 event entries). A pending order holds its seats/slot while the student pays:
 * 15 minutes for card/gateway checkout, 30 minutes for bank UPI with no UTR yet. A bank-UPI order with a UTR stays
 * pending (money may have left the student's account) until it is matched or the organizer decides.
 */
export const HOLD_MINUTES = 15;
export const UPI_HOLD_MINUTES = 30;

type Tag = postgres.Sql | postgres.TransactionSql;

/** SQL condition: pending order `o` whose hold has run out (so it no longer holds anything). */
export const holdExpired = (q: Tag, o = 'o') => q`(
  ${q(o)}.status = 'pending' and (
    (${q(o)}.method <> 'upi_direct' and ${q(o)}.created_at < now() - make_interval(mins => ${HOLD_MINUTES}))
    or (${q(o)}.method = 'upi_direct' and ${q(o)}.utr is null and ${q(o)}.created_at < now() - make_interval(mins => ${UPI_HOLD_MINUTES}))))`;

/** SQL condition: order `o` is pending and still inside its hold (a payment really is in progress). */
export const holdLive = (q: Tag, o = 'o') => q`(${q(o)}.status = 'pending' and not ${holdExpired(q, o)})`;

/** SQL expression: seats of ticket type `tt` taken, not counting holds that have run out (for display only). */
export const takenLive = (q: Tag, tt = 'tt') => q`(${q(tt)}.sold - (
  select coalesce(sum(o.qty), 0) from orders o where o.ticket_type_id = ${q(tt)}.id and ${holdExpired(q, 'o')}))::int`;

/**
 * Release this ticket type's expired holds; returns seats freed. The caller must hold the ticket_types row lock and
 * write `sold` back (createOrder) — or use releaseHolds below.
 * `skip locked`: an order locked by a late webhook (fulfilOrder locks the order, then the ticket type) is left alone
 * instead of waited on, so the two can never deadlock; fulfilOrder then marks it paid itself.
 */
export async function releaseExpiredHolds(tx: postgres.TransactionSql, ticketTypeId: string) {
  const expired = await tx<{ qty: number }[]>`
    update orders set status = 'failed'
    where id in (select o.id from orders o where o.ticket_type_id = ${ticketTypeId} and ${holdExpired(tx, 'o')} for update skip locked)
      and status = 'pending'
    returning qty`;
  return expired.reduce((a, r) => a + r.qty, 0);
}

/** Release expired holds and write the freed seats back to `sold` at once. Returns seats freed. */
export async function releaseHolds(tx: postgres.TransactionSql, ticketTypeId: string) {
  const n = await releaseExpiredHolds(tx, ticketTypeId);
  if (n) await tx`update ticket_types set sold = greatest(sold - ${n}, 0) where id = ${ticketTypeId}`;
  return n;
}

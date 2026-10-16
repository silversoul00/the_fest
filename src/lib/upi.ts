import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { fulfilOrder, OrderError } from './orders';
import { UTR_RE, type Credit } from './upi-parse';
import { notifyOrderPaid } from './mail';

export type MatchResult = {
  matched: { orderId: string; utr: string | null; amountPaise: number; how: 'utr' | 'amount' }[];
  flagged: { orderId: string; utr: string | null; amountPaise: number; reason: string }[];
  unmatched: Credit[];
  duplicates: number;
};

/**
 * Match bank credits to open bank-UPI orders of one fest.
 * 1. Same UTR the student typed + exact amount → confirm.
 * 2. Same UTR but different amount → flag for the organizer.
 * 3. No UTR match → if exactly one open order has this exact (paise-tagged) amount → confirm.
 * Every credit is stored once per UTR, so the same payment can never confirm two orders.
 * Unmatched credits are kept: when a student later submits that UTR, it confirms instantly.
 */
export async function matchCredits(festId: string, credits: Credit[], source: 'statement' | 'email' | 'paste'): Promise<MatchResult> {
  const res: MatchResult = { matched: [], flagged: [], unmatched: [], duplicates: 0 };

  for (const c of credits) {
    if (c.utr && !UTR_RE.test(c.utr)) c.utr = null;
    let creditId: number | null = null;

    if (c.utr) {
      const [existing] = await sql<{ id: number; matched_order_id: string | null }[]>`
        select id, matched_order_id from upi_credits where fest_id = ${festId} and utr = ${c.utr}`;
      if (existing?.matched_order_id) { res.duplicates++; continue; }
      if (existing) creditId = existing.id;
    }
    if (!creditId) {
      const [ins] = await sql<{ id: number }[]>`
        insert into upi_credits (fest_id, utr, amount_paise, source, raw)
        values (${festId}, ${c.utr}, ${c.amountPaise}, ${source}, ${c.raw})
        on conflict do nothing returning id`;
      if (!ins) { res.duplicates++; continue; }
      creditId = ins.id;
    }

    // 1/2: by UTR
    let order: { id: string; amount_paise: number } | undefined;
    if (c.utr) {
      [order] = await sql<{ id: string; amount_paise: number }[]>`
        select id, amount_paise from orders
        where fest_id = ${festId} and method = 'upi_direct' and utr = ${c.utr} and status in ('pending', 'failed')`;
      if (order && order.amount_paise !== c.amountPaise) {
        const reason = `Paid ₹${(c.amountPaise / 100).toFixed(2)}, expected ₹${(order.amount_paise / 100).toFixed(2)}`;
        await sql`update orders set review_flag = ${reason} where id = ${order.id}`;
        await sql`update upi_credits set matched_order_id = ${order.id} where id = ${creditId}`;
        res.flagged.push({ orderId: order.id, utr: c.utr, amountPaise: c.amountPaise, reason });
        continue;
      }
    }
    let how: 'utr' | 'amount' = 'utr';
    // 3: by unique amount
    if (!order) {
      const cands = await sql<{ id: string; amount_paise: number; utr: string | null }[]>`
        select id, amount_paise, utr from orders
        where fest_id = ${festId} and method = 'upi_direct' and amount_paise = ${c.amountPaise}
          and status in ('pending', 'failed') and created_at > now() - interval '7 days'`;
      if (cands.length === 1) {
        order = cands[0]; how = 'amount';
        if (c.utr && cands[0].utr !== c.utr) {
          // Student typed a different (wrong) UTR, or none. Record the real one.
          try { await sql`update orders set utr = ${c.utr}, utr_submitted_at = coalesce(utr_submitted_at, now()) where id = ${order.id}`; }
          catch { /* UTR already on another order — leave as is, still matched by amount */ }
        }
      }
    }
    if (!order) { res.unmatched.push(c); continue; }

    try {
      await fulfilOrder(order.id, { provider: 'upi_direct', paymentId: c.utr ?? undefined, verifySource: source });
      await sql`update upi_credits set matched_order_id = ${order.id} where id = ${creditId}`;
      res.matched.push({ orderId: order.id, utr: c.utr, amountPaise: c.amountPaise, how });
      notifyOrderPaid(order.id).catch(() => {});
    } catch (e) {
      const reason = e instanceof OrderError ? e.message : 'Could not confirm';
      await sql`update upi_credits set matched_order_id = ${order.id} where id = ${creditId}`;
      res.flagged.push({ orderId: order.id, utr: c.utr, amountPaise: c.amountPaise, reason });
    }
  }
  return res;
}

/** Student submits the UTR from their UPI app. Confirms instantly if the bank credit is already known. */
export async function submitUtr(orderId: string, userId: string, utrRaw: string): Promise<{ status: 'confirmed' | 'waiting' }> {
  const utr = utrRaw.replace(/\D/g, '');
  if (!UTR_RE.test(utr)) throw new OrderError('The UPI reference number (UTR) is 12 digits — check your UPI app’s payment details.');
  const [o] = await sql<{ id: string; fest_id: string; amount_paise: number; status: string; utr: string | null }[]>`
    select id, fest_id, amount_paise, status, utr from orders
    where id = ${orderId} and user_id = ${userId} and method = 'upi_direct'`;
  if (!o) throw new OrderError('Order not found.');
  if (o.status === 'paid') return { status: 'confirmed' };
  if (o.status !== 'pending' && o.status !== 'failed') throw new OrderError('This order can’t take a payment any more.');
  if (o.utr && o.utr !== utr) throw new OrderError('A different UTR is already saved for this order. Ask the organizer if it was wrong.');
  try {
    await sql`update orders set utr = ${utr}, utr_submitted_at = now() where id = ${orderId}`;
  } catch {
    throw new OrderError('This UTR has already been used for another order.');
  }
  // Credit already seen (statement uploaded or alert forwarded before the student typed it)?
  const [credit] = await sql<{ id: number; amount_paise: number; source: string; matched_order_id: string | null }[]>`
    select id, amount_paise, source, matched_order_id from upi_credits where fest_id = ${o.fest_id} and utr = ${utr}`;
  if (credit && !credit.matched_order_id) {
    const r = await matchCredits(o.fest_id, [{ utr, amountPaise: credit.amount_paise, raw: '' }], credit.source as 'statement');
    if (r.matched.some((m) => m.orderId === orderId)) return { status: 'confirmed' };
  }
  return { status: 'waiting' };
}

/** Organizer confirms an order by hand (e.g. checked their bank app). */
export async function confirmManually(orderId: string, festId: string) {
  const [o] = await sql<{ id: string; utr: string | null }[]>`
    select id, utr from orders where id = ${orderId} and fest_id = ${festId} and method = 'upi_direct' and status in ('pending', 'failed')`;
  if (!o) throw new OrderError('Order not found or already handled.');
  await fulfilOrder(o.id, { provider: 'upi_direct', paymentId: o.utr ?? undefined, verifySource: 'manual' });
  notifyOrderPaid(o.id).catch(() => {});
}

/** Organizer rejects an order (no money arrived). Seats go back on sale. */
export async function rejectUpiOrder(orderId: string, festId: string, note: string) {
  await sql.begin(async (tx) => {
    const [o] = await tx<{ qty: number; ticket_type_id: string; status: string }[]>`
      select qty, ticket_type_id, status from orders
      where id = ${orderId} and fest_id = ${festId} and method = 'upi_direct' and status in ('pending', 'failed') for update`;
    if (!o) throw new OrderError('Order not found or already handled.');
    await tx`update orders set status = 'failed', review_flag = ${('Rejected: ' + note).slice(0, 200)}, utr = null where id = ${orderId}`;
    if (o.status === 'pending') await tx`update ticket_types set sold = greatest(sold - ${o.qty}, 0) where id = ${o.ticket_type_id}`;
  });
}

export const newInboundToken = () => randomBytes(18).toString('base64url');

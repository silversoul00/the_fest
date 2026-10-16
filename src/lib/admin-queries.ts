import 'server-only';
import { sql } from './db';

/*
 * Money per fest.
 * • Card/UPI gateway orders (Cashfree/Razorpay) settle into THE FEST's account →
 *   THE FEST owes the fest: amount − refunds − THE FEST fee − gateway charges.
 * • Zero-fee bank UPI orders settle into the FEST's own account →
 *   the fest owes THE FEST its fee on those tickets.
 * • Demo orders are not real money and are excluded.
 * Balance > 0 → pay the fest. Balance < 0 → the fest owes THE FEST.
 */
export type FestMoney = {
  id: string; name: string; slug: string; status: string; organizer: string; organizer_email: string; college: string; starts_on: string;
  tickets: number; gateway_net: number; upi_fees_due: number; paid_out: number; balance: number; fee_revenue: number; gmv: number; demo_orders: number;
};

export const festMoney = () => sql<FestMoney[]>`
  with o as (
    select fest_id,
      sum(case when provider in ('cashfree','razorpay') and status in ('paid','refunded')
               then amount_paise - refunded_paise - platform_fee_paise - gateway_fee_paise else 0 end)::bigint as gateway_net,
      sum(case when provider = 'upi_direct' and status = 'paid' then platform_fee_paise else 0 end)::bigint as upi_fees_due,
      sum(case when provider in ('cashfree','razorpay','upi_direct') and status in ('paid','refunded') then platform_fee_paise else 0 end)::bigint as fee_revenue,
      sum(case when provider in ('cashfree','razorpay','upi_direct') and status in ('paid','refunded') then amount_paise - refunded_paise else 0 end)::bigint as gmv,
      count(*) filter (where provider = 'demo' and status = 'paid')::int as demo_orders
    from orders group by fest_id
  ), p as (select fest_id, sum(amount_paise)::bigint as paid_out from payouts group by fest_id)
  select f.id, f.name, f.slug, f.status, u.name as organizer, u.email::text as organizer_email, f.college, f.starts_on,
    (select count(*) from tickets t where t.fest_id = f.id and t.status <> 'void')::int as tickets,
    coalesce(o.gateway_net, 0)::int as gateway_net, coalesce(o.upi_fees_due, 0)::int as upi_fees_due,
    coalesce(p.paid_out, 0)::int as paid_out,
    (coalesce(o.gateway_net, 0) - coalesce(o.upi_fees_due, 0) - coalesce(p.paid_out, 0))::int as balance,
    coalesce(o.fee_revenue, 0)::int as fee_revenue, coalesce(o.gmv, 0)::int as gmv, coalesce(o.demo_orders, 0)::int as demo_orders
  from fests f join users u on u.id = f.organizer_id
  left join o on o.fest_id = f.id left join p on p.fest_id = f.id
  order by (f.status = 'review') desc, f.starts_on desc`;

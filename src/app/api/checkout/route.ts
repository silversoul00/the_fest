import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { body, fail, isUuid, json, sameOrigin } from '@/lib/http';
import { cancelOrder, createOrder, fulfilOrder, OrderError } from '@/lib/orders';
import { activeGateway, createRazorpayOrder } from '@/lib/payments';
import { cashfreeMode, createCashfreeOrder } from '@/lib/cashfree';
import { upiLink } from '@/lib/upi-parse';
import { notifyOrderPaid } from '@/lib/mail';

const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail('Bad origin', 403);
  const user = await getUser();
  if (!user) return fail('Please log in to buy tickets.', 401);
  if (user.role !== 'student') return fail('Tickets are bought from a student account.', 403);

  const b = await body<{ ticketTypeId?: string; qty?: number; method?: string; phone?: string }>(req);
  if (!b || !isUuid(b.ticketTypeId)) return fail('Choose a ticket type.');
  const method = b.method === 'upi_direct' ? 'upi_direct' : 'gateway';

  // Cashfree requires a phone number; collect it once and keep it on the profile
  let phone = user.phone?.replace(/\D/g, '').slice(-10) ?? '';
  if (b.phone) {
    const p = String(b.phone).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(p)) return fail('Enter a valid 10-digit Indian mobile number.');
    phone = p;
    await sql`update users set phone = ${p} where id = ${user.id}`;
  }

  try {
    const gw = activeGateway();
    if (method === 'gateway' && gw === 'cashfree' && !/^[6-9]\d{9}$/.test(phone)) {
      return fail('Add your mobile number to continue to payment.', 428);
    }

    const o = await createOrder({ userId: user.id, ticketTypeId: b.ticketTypeId, qty: Number(b.qty ?? 1), method });

    if (o.free) {
      await fulfilOrder(o.orderId, { provider: 'free' });
      notifyOrderPaid(o.orderId).catch(() => {});
      return json({ mode: 'done', orderId: o.orderId });
    }

    if (method === 'upi_direct') {
      const [f] = await sql<{ upi_vpa: string; upi_name: string | null; name: string }[]>`
        select upi_vpa, upi_name, name from fests where id = ${o.festId}`;
      const note = `TF ${o.orderId.slice(0, 8).toUpperCase()}`;
      return json({
        mode: 'upi', orderId: o.orderId, amount: o.amount, vpa: f.upi_vpa, payee: f.upi_name || f.name, note,
        link: upiLink(f.upi_vpa, f.upi_name || f.name, o.amount, note),
      });
    }

    if (gw === 'demo') return json({ mode: 'demo', orderId: o.orderId, amount: o.amount });

    try {
      if (gw === 'cashfree') {
        const cf = await createCashfreeOrder({
          orderId: o.orderId, amountPaise: o.amount,
          returnUrl: `${site()}/checkout/return?order_id={order_id}`,
          notifyUrl: `${site()}/api/webhooks/cashfree`,
          customer: { id: user.id, phone, email: user.email, name: user.name },
        });
        await sql`update orders set provider = 'cashfree', provider_order_id = ${cf.cfOrderId} where id = ${o.orderId}`;
        return json({ mode: 'cashfree', orderId: o.orderId, amount: o.amount, paymentSessionId: cf.paymentSessionId, env: cashfreeMode() });
      }
      const rzp = await createRazorpayOrder(o.amount, o.orderId.slice(0, 40), { order_id: o.orderId, user_id: user.id });
      await sql`update orders set provider = 'razorpay', razorpay_order_id = ${rzp.id} where id = ${o.orderId}`;
      return json({ mode: 'razorpay', orderId: o.orderId, rzpOrderId: rzp.id, amount: o.amount, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (e) {
      console.error(`${gw} order create failed`, e);
      await cancelOrder(o.orderId, user.id);
      return fail('Payment provider is unavailable right now. Please try again in a minute.', 502);
    }
  } catch (e) {
    if (e instanceof OrderError) return fail(e.message, 409);
    console.error('checkout failed', e);
    return fail('Could not start checkout. Please try again.', 500);
  }
}

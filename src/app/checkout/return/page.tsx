import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { getCashfreePayment } from '@/lib/cashfree';
import { confirmCashfree } from '@/lib/confirm';

export const metadata = { title: 'Payment' };

// Cashfree sends students here after paying in a full-page (redirect) flow.
export default async function CheckoutReturn({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const { order_id } = await searchParams;
  const user = await getUser();
  if (!user) redirect('/login');
  let message = 'We couldn’t find that order.';
  if (isUuid(order_id)) {
    const [o] = await sql<{ status: string; slug: string }[]>`
      select o.status, f.slug from orders o join fests f on f.id = o.fest_id where o.id = ${order_id} and o.user_id = ${user.id}`;
    if (o?.status === 'paid') redirect(`/tickets?order=${order_id}`);
    if (o) {
      try {
        const p = await getCashfreePayment(order_id);
        if (p.paid && (await confirmCashfree(order_id, p)).ok) redirect(`/tickets?order=${order_id}`);
        message = p.paid ? 'Payment received — your tickets need a quick check by the organizer.' : 'The payment didn’t go through. No money was taken.';
      } catch (e) {
        if ((e as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e;
        message = 'We’re still confirming your payment. Your tickets will appear in My Tickets within a few minutes.';
      }
    }
  }
  return (
    <main className="auth-shell">
      <div className="stack g16 narrow" style={{ textAlign: 'center', alignItems: 'center' }}>
        <div className="logo">THE FEST</div>
        <h1 className="h2">Payment</h1>
        <p className="soft">{message}</p>
        <Link href="/tickets" className="btn">My tickets</Link>
      </div>
    </main>
  );
}

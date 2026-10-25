import Link from 'next/link';
import { BIZ, LegalPage } from '@/components/Legal';

export const metadata = { title: 'Ticket delivery' };

export default function Delivery() {
  return (
    <LegalPage title="Ticket delivery" updated="17 October 2026">
      <p>THE FEST sells digital tickets only. Nothing is shipped.</p>
      <ul>
        <li><b>Card/UPI checkout:</b> tickets appear on your <Link href="/tickets">Tickets</Link> page within seconds of payment, and you get a confirmation email.</li>
        <li><b>UPI to the fest:</b> tickets appear once the fest&apos;s bank shows your payment — usually within minutes, at most 24 hours.</li>
        <li>Each ticket is a QR code. Show it at the gate from your phone; it also works if you saved the page while online.</li>
      </ul>
      <p>
        If a ticket doesn&apos;t appear, write to <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a> with your order number. See also
        our <Link href="/legal/refunds">refund policy</Link>.
      </p>
    </LegalPage>
  );
}

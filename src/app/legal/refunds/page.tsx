import { BIZ, LegalPage } from '@/components/Legal';

export const metadata = { title: 'Refunds & cancellations' };

export default function Refunds() {
  return (
    <LegalPage title="Refunds & cancellations" updated="17 October 2026">
      <h2>If the fest is cancelled</h2>
      <p>
        You get <b>everything back</b>: the ticket price, the convenience fee and any payment charges. Refunds start the moment the organizer
        cancels and you get an email.
      </p>

      <h2>If you can&apos;t go</h2>
      <p>
        Tickets are generally non-refundable once bought, unless the fest page says otherwise. Instead, you can <b>transfer</b> your ticket
        to a friend from the Tickets page, if the organizer allows transfers. Organizers may still refund you at their discretion; if they
        do, you get the full amount you paid for those tickets.
      </p>

      <h2>If the date, venue or headliner changes a lot</h2>
      <p>
        Write to the organizer or to us. If the change is major (a different date, or a headline act that was the main reason for the
        ticket is dropped), we will ask the organizer to offer refunds.
      </p>

      <h2>If you were charged but got no ticket</h2>
      <p>
        Card/UPI checkout: if the payment fails or the seats ran out, any amount taken is returned automatically. Write to us with your
        order number if it doesn&apos;t arrive in 7 working days.
      </p>
      <p>
        UPI to the fest: if your payment can&apos;t be matched (for example, a wrong amount), the organizer will check it with you and either
        issue the ticket or send the money back.
      </p>

      <h2>How long refunds take</h2>
      <ul>
        <li><b>Card/UPI checkout:</b> we send the refund to the payment company straight away. It reaches your account in about 5–7 working days, depending on your bank.</li>
        <li><b>UPI to the fest:</b> the money went to the fest&apos;s own account, so the organizer sends it back by UPI to the account you paid from, usually within 7 working days.</li>
      </ul>

      <h2>Used tickets</h2>
      <p>Tickets that have already been scanned at the gate can&apos;t be refunded.</p>

      <h2>Need help?</h2>
      <p>Write to <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a> with your order number.</p>
    </LegalPage>
  );
}

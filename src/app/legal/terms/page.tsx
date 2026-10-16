import Link from 'next/link';
import { BIZ, Fill, LegalPage } from '@/components/Legal';

export const metadata = { title: 'Terms of use' };

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="17 October 2026">
      <p>
        These terms apply when you use THE FEST (thefest.in and its apps), run by <b><Fill v={BIZ.legalName} what="legal name of the business" /></b>{' '}
        (&ldquo;THE FEST&rdquo;, &ldquo;we&rdquo;). By creating an account or buying a ticket you agree to them.
      </p>

      <h2>1. What THE FEST does</h2>
      <p>
        THE FEST is a platform that lets college fests (&ldquo;organizers&rdquo;) sell tickets, check people in at the gate and report
        results to sponsors. <b>Each fest is run by its organizer, not by THE FEST.</b> The organizer is responsible for the event itself —
        the line-up, venue, timings, safety, entry rules and anything promised on the fest page.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>Give your real name and an email you can access. You are responsible for activity on your account.</li>
        <li>Keep your password private. If you think someone else has used your account, reset your password and write to us.</li>
        <li>We may suspend accounts used for fraud, ticket touting, abuse or anything unlawful.</li>
      </ul>

      <h2>3. Buying tickets</h2>
      <ul>
        <li>The price you pay is shown before you pay: ticket price, plus a convenience fee and, for card/UPI checkout, payment charges.</li>
        <li>A ticket is issued only after the payment is confirmed. For &ldquo;UPI to the fest&rdquo;, that happens once the fest&apos;s bank shows your payment.</li>
        <li>Each ticket has a signed QR code that admits one person once. Copies or screenshots shared with others will be refused after the first scan.</li>
        <li>The organizer may ask for a college ID or other proof at the gate and may refuse entry under its own rules.</li>
        <li>Refunds and cancellations follow our <Link href="/legal/refunds">refund policy</Link>.</li>
      </ul>

      <h2>4. Transfers and resale</h2>
      <p>
        You can transfer a ticket to another person through the app if the organizer allows it; the old QR stops working. Reselling tickets
        above face value is not allowed and such tickets may be cancelled without refund.
      </p>

      <h2>5. Organizers</h2>
      <ul>
        <li>Organizers must have permission from their college or institution to run and sell tickets for the fest.</li>
        <li>New fests are reviewed by THE FEST before going live. We may refuse or take down a fest that looks misleading or unsafe.</li>
        <li>Money collected through card/UPI checkout is paid out to the organizer after deducting THE FEST&apos;s fee and payment charges, and after refunds.</li>
        <li>If an organizer cancels a fest, every buyer must be refunded in full. Organizers who receive money directly to their own UPI must send those refunds themselves.</li>
        <li>Organizers must handle attendee data only to run their fest and must not sell or misuse it.</li>
      </ul>

      <h2>6. Sponsors</h2>
      <p>
        Footfall and booth-visit numbers are counted from real scans. They are provided as is; we do our best to keep them accurate but do
        not guarantee them for any commercial purpose.
      </p>

      <h2>7. What you must not do</h2>
      <ul>
        <li>Fake, copy or tamper with tickets or QR codes.</li>
        <li>Try to break, overload or get around the security of the platform.</li>
        <li>Use the platform to harass anyone or to post unlawful content.</li>
      </ul>

      <h2>8. Liability</h2>
      <p>
        THE FEST is not responsible for how a fest is run, for injury or loss at an event, or for an organizer&apos;s acts. To the extent the
        law allows, our total liability to you for any claim is limited to the fees you paid THE FEST for the ticket in question.
        Nothing here limits rights you have under the Consumer Protection Act, 2019.
      </p>

      <h2>9. Changes and law</h2>
      <p>
        We may update these terms; the date above will change and important changes will be emailed to you. These terms are governed by
        the laws of India, with courts at Bengaluru having jurisdiction.
      </p>

      <h2>10. Contact and grievances</h2>
      <p>
        Questions or complaints: <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a>. See <Link href="/legal/contact">Contact</Link> for our
        grievance officer.
      </p>
    </LegalPage>
  );
}

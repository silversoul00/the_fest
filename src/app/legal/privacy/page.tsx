import Link from 'next/link';
import { BIZ, Fill, LegalPage } from '@/components/Legal';

export const metadata = { title: 'Privacy policy' };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="17 October 2026">
      <p>
        This explains what personal data THE FEST collects, why, and what you can do about it. It is written with the Digital Personal
        Data Protection Act, 2023 in mind. <b><Fill v={BIZ.legalName} what="legal name of the business" /></b> is the data fiduciary.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> name, email, phone and college (if you add them) and a scrambled (hashed) version of your password — never the password itself.</li>
        <li><b>Tickets and orders:</b> which fest and tickets you bought, amounts, and payment references. For card/UPI checkout, your phone number goes to the payment company.</li>
        <li><b>UPI to the fest:</b> the UTR (transaction number) you enter, matched against the fest&apos;s bank records.</li>
        <li><b>At the fest:</b> the time your ticket was scanned, at which gate, and which sponsor booths scanned you.</li>
        <li><b>Technical:</b> a login cookie, and basic server logs (IP address, browser) kept for security.</li>
      </ul>
      <p>We do <b>not</b> see or store your card number, UPI PIN or bank login. Payments are handled by Cashfree or Razorpay.</p>

      <h2>Why we use it</h2>
      <ul>
        <li>To issue your tickets, let you in at the gate, send order and refund emails, and handle refunds.</li>
        <li>To stop fraud, such as duplicate entries or fake payments.</li>
        <li>To show organizers and sponsors <b>counts</b> (how many people came, how many visited a booth). Sponsors see totals, not your name or email.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li><b>The fest organizer</b> you bought from: your name, email and tickets, to run the event.</li>
        <li><b>Payment companies</b> (Cashfree, Razorpay) to take payments and send refunds.</li>
        <li><b>Service providers</b> that host our database and website and send email (e.g. Supabase, Vercel, Resend), only to run the service.</li>
        <li>Authorities, if the law requires it.</li>
      </ul>
      <p>We do not sell your data and do not show you third-party ads.</p>

      <h2>How long we keep it</h2>
      <p>
        Account data for as long as you have an account. Order and payment records for 8 years, as Indian tax and accounting law
        requires. Server logs for up to 90 days.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>See the data we hold about you, or get it corrected.</li>
        <li>Delete your account (order records we must keep by law stay, but are no longer linked to your login).</li>
        <li>Withdraw consent for anything optional, and name someone to act for you.</li>
        <li>Complain to our grievance officer (see <Link href="/legal/contact">Contact</Link>) and, if unhappy, to the Data Protection Board of India.</li>
      </ul>
      <p>Write to <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a> for any of these. We reply within 30 days.</p>

      <h2>Children</h2>
      <p>
        THE FEST is meant for college students and adults. If you are under 18, use it only with a parent or guardian&apos;s consent.
      </p>

      <h2>Security</h2>
      <p>
        Passwords are hashed, tickets are cryptographically signed, connections are encrypted, and access to data is limited to people who
        need it. If a breach affects you, we will tell you and the authorities as the law requires.
      </p>
    </LegalPage>
  );
}

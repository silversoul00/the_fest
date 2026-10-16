import { BIZ, Fill, LegalPage } from '@/components/Legal';

export const metadata = { title: 'Contact' };

export default function Contact() {
  return (
    <LegalPage title="Contact us" updated="17 October 2026">
      <h2>Support</h2>
      <ul>
        <li>Email: <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a> — we reply within 1 working day.</li>
        <li>Phone / WhatsApp: <Fill v={BIZ.phone} what="support phone number" /></li>
      </ul>
      <p>For a problem with a fest itself (timings, entry, line-up), contact the organizer listed on the fest page first.</p>

      <h2>Business details</h2>
      <ul>
        <li>Name: <Fill v={BIZ.legalName} what="legal name of the business" /></li>
        <li>Address: <Fill v={BIZ.address} what="registered address" /></li>
      </ul>

      <h2>Grievance officer</h2>
      <p>
        <Fill v={BIZ.grievanceOfficer} what="name of grievance officer" /> · <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a>
        <br />We acknowledge complaints within 48 hours and resolve them within 30 days.
      </p>
    </LegalPage>
  );
}

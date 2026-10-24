import 'server-only';
import { sql } from './db';
import { rupees } from './format';
import { siteUrl } from './env';
import { reportError } from './errors';
import { requestEmailTargets } from './sponsor-requests';

/*
 * Email via Resend (https://resend.com) — free for 3,000 emails/month.
 * Env: RESEND_API_KEY, EMAIL_FROM (e.g. "THE FEST <tickets@thefest.in>", domain verified in Resend).
 * Without a key, emails are stored in email_outbox with status 'logged' so
 * nothing is lost and links can be read during development/testing.
 */
const site = siteUrl;

export async function sendEmail(to: string, subject: string, text: string, opts: { reportFailures?: boolean } = {}) {
  const [row] = await sql<{ id: number }[]>`
    insert into email_outbox (to_email, subject, body_text) values (${to}, ${subject}, ${text}) returning id`;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    await sql`update email_outbox set status = 'logged' where id = ${row.id}`;
    return { sent: false };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM?.trim() || 'THE FEST <onboarding@resend.dev>', to: [to], subject, text }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    // Once delivered, don't keep live one-time links (password reset, email confirm) in the database
    await sql`update email_outbox set status = 'sent', body_text = regexp_replace(body_text, 'token=[A-Za-z0-9_-]+', 'token=[redacted]', 'g') where id = ${row.id}`;
    return { sent: true };
  } catch (e) {
    await sql`update email_outbox set status = 'failed', error = ${String(e).slice(0, 500)} where id = ${row.id}`;
    if (opts.reportFailures !== false) await reportError(e, 'email', { alert: true });
    else console.error('email failed', e);
    return { sent: false };
  }
}

export async function notifyOrderPaid(orderId: string) {
  const [o] = await sql<{ email: string; name: string; fest: string; qty: number; amount_paise: number; type: string; starts_on: string }[]>`
    select u.email::text, u.name, f.name as fest, o.qty, o.amount_paise, tt.name as type, f.starts_on
    from orders o join users u on u.id = o.user_id join fests f on f.id = o.fest_id join ticket_types tt on tt.id = o.ticket_type_id
    where o.id = ${orderId} and o.status = 'paid'`;
  if (!o) return;
  await sendEmail(o.email, `Your tickets for ${o.fest} 🎟️`, [
    `Hi ${o.name.split(' ')[0]},`,
    '',
    `You're in! ${o.qty} × ${o.type} for ${o.fest}${o.amount_paise ? ` (paid ${rupees(o.amount_paise)})` : ''}.`,
    '',
    `Your QR ticket: ${site()}/tickets?order=${orderId}`,
    '',
    'Show the QR at the gate — it works once. Don’t share it: whoever scans first gets in.',
    '',
    '— THE FEST',
  ].join('\n'));
}

export async function notifyRefund(orderId: string, amountPaise: number, reason: string) {
  const [o] = await sql<{ email: string; name: string; fest: string; method: string }[]>`
    select u.email::text, u.name, f.name as fest, o.method
    from orders o join users u on u.id = o.user_id join fests f on f.id = o.fest_id where o.id = ${orderId}`;
  if (!o) return;
  await sendEmail(o.email, `Refund for ${o.fest}`, [
    `Hi ${o.name.split(' ')[0]},`,
    '',
    `Your tickets for ${o.fest} were cancelled: ${reason}`,
    o.method === 'upi_direct'
      ? `The organizer will send ${rupees(amountPaise)} back to the UPI account you paid from.`
      : `A refund of ${rupees(amountPaise)} has been started and usually reaches your account in 5–7 working days.`,
    '',
    '— THE FEST',
  ].join('\n'));
}

/**
 * Sponsorship request emails. 'new' goes to the receiving side (the brand, or the fest owner + co-organizers);
 * 'declined' goes to whoever sent it; 'accepted' goes to both sides. Contacts appear only in 'accepted'.
 */
export async function notifySponsorRequest(id: string, event: 'new' | 'accepted' | 'declined') {
  const r = await requestEmailTargets(id);
  if (!r) return;
  const toBrand = (r.direction === 'org_to_brand') === (event === 'new');
  const orgLink = `${site()}/organizer/${r.fest_id}/sponsors`;
  const sign = ['', '— THE FEST'];
  if (event === 'new') {
    if (toBrand) {
      await sendEmail(r.brand_email, `${r.fest_name} invites ${r.brand} to sponsor`, [
        `${r.fest_name} sent ${r.brand} a sponsorship request: ${r.tier}, ${rupees(r.amount_paise)}.`, '',
        `See it and answer: ${site()}/sponsor/requests`, ...sign].join('\n'));
    } else {
      for (const to of r.orgEmails) {
        await sendEmail(to, `${r.brand} wants to sponsor ${r.fest_name}`, [
          `${r.brand} asked to sponsor ${r.fest_name}: ${r.tier}, ${rupees(r.amount_paise)}.`, '',
          `See it and answer: ${orgLink}`, ...sign].join('\n'));
      }
    }
    return;
  }
  if (event === 'declined') {
    if (!r.sender_email) return;
    await sendEmail(r.sender_email, `Sponsorship request declined: ${r.brand} × ${r.fest_name}`, [
      `The request between ${r.brand} and ${r.fest_name} was declined.`,
      ...(r.reply ? ['', `Their note: ${r.reply}`] : []), '',
      `Details: ${r.direction === 'brand_to_org' ? `${site()}/sponsor/requests` : orgLink}`, ...sign].join('\n'));
    return;
  }
  // accepted: both sides, now with each other's contact
  await sendEmail(r.brand_email, `${r.fest_name} × ${r.brand}: sponsorship confirmed`, [
    `${r.brand} is now a ${r.tier} sponsor of ${r.fest_name} (${rupees(r.amount_paise)}).`,
    `Organizer contact: ${r.owner_email}`, '',
    `Your live sponsor dashboard: ${site()}/sponsor/${r.sponsor_id}`, '',
    'Payment is settled directly between you; THE FEST doesn’t take a cut yet.', ...sign].join('\n'));
  for (const to of r.orgEmails) {
    await sendEmail(to, `${r.fest_name} × ${r.brand}: sponsorship confirmed`, [
      `${r.brand} is now a ${r.tier} sponsor of ${r.fest_name} (${rupees(r.amount_paise)}).`,
      `Sponsor contact: ${r.brand_email}`, '',
      `Sponsors tab (booth QR, report): ${orgLink}`, '',
      'Payment is settled directly between you; THE FEST doesn’t take a cut yet.', ...sign].join('\n'));
  }
}

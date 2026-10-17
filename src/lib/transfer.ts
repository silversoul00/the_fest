import 'server-only';
import { sql } from './db';
import { ticketCode } from './ticket-crypto';
import { sendEmail } from './mail';
import { todayIST } from './format';
import { siteUrl } from './env';
import { afterResponse } from './errors';

export class TransferError extends Error {}

/**
 * Moves a ticket to another student. The old ticket is voided (its QR and code stop working)
 * and a brand-new ticket with a new QR is issued to the recipient, on the same order — so a
 * later refund of that order still goes back to whoever paid.
 */
export async function transferTicket(ticketId: string, fromUserId: string, toEmailRaw: string) {
  const toEmail = toEmailRaw.trim().toLowerCase();
  const res = await sql.begin(async (tx) => {
    const [t] = await tx<{ id: string; status: string; order_id: string; fest_id: string; ticket_type_id: string; fest_name: string; fest_status: string; ends_on: string; allow_transfers: boolean; from_name: string; from_email: string }[]>`
      select t.id, t.status, t.order_id, t.fest_id, t.ticket_type_id, f.name as fest_name, f.status as fest_status, f.ends_on,
             f.allow_transfers, u.name as from_name, u.email::text as from_email
      from tickets t join fests f on f.id = t.fest_id join users u on u.id = t.user_id
      where t.id = ${ticketId} and t.user_id = ${fromUserId}
      for update of t`;
    if (!t) throw new TransferError('Ticket not found.');
    if (t.status === 'used') throw new TransferError('This ticket has already been used at the gate.');
    if (t.status !== 'valid') throw new TransferError('This ticket is no longer valid.');
    if (!t.allow_transfers) throw new TransferError('This fest doesn’t allow ticket transfers.');
    if (t.fest_status === 'cancelled' || t.fest_status === 'ended' || t.ends_on < todayIST()) throw new TransferError('This fest is over.');
    if (toEmail === t.from_email.toLowerCase()) throw new TransferError('That’s your own email.');

    const [to] = await tx<{ id: string; name: string; role: string }[]>`select id, name, role from users where email = ${toEmail}`;
    if (!to) throw new TransferError('No THE FEST account uses that email. Ask your friend to sign up first, then try again.');
    if (to.role !== 'student') throw new TransferError('That email belongs to an organizer or sponsor account. Tickets can only go to student accounts.');

    const [n] = await tx<{ id: string }[]>`
      insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name)
      values (${ticketCode()}, ${t.order_id}, ${to.id}, ${t.fest_id}, ${t.ticket_type_id}, ${to.name})
      returning id`;
    await tx`update tickets set status = 'void', void_reason = ${`Transferred to ${to.name}`}, transferred_to = ${n.id} where id = ${t.id}`;
    return { newId: n.id, to, from: { name: t.from_name, email: t.from_email }, festName: t.fest_name };
  });

  await afterResponse('transfer email', async () => {
    await sendEmail(toEmail, `${res.from.name} sent you a ticket to ${res.festName}`, [
      `Hi ${res.to.name.split(' ')[0]},`, '',
      `${res.from.name} transferred a ticket for ${res.festName} to you. It's in your account now:`, '',
      `${siteUrl()}/tickets/${res.newId}`, '', '— THE FEST',
    ].join('\n'));
  });
  await afterResponse('transfer email', () => sendEmail(res.from.email, `Ticket to ${res.festName} transferred`, [
    `Your ticket for ${res.festName} now belongs to ${res.to.name} (${toEmail}). Your old QR code no longer works.`, '', '— THE FEST',
  ].join('\n')));
  return res;
}

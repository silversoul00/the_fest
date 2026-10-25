import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { eventsReady, EVENTS_MISSING } from '@/lib/fest-access';
import { dayLabel, rupees, time } from '@/lib/format';
import { teamText } from '@/lib/event-format';
import { activeGateway, eventFees } from '@/lib/payments';
import { ActionForm, FlashMessage, Submit } from '@/components/forms';
import { holdLive, takenLive } from '@/lib/holds';
import { Empty } from '@/components/ui';
import { BuyTickets } from '../fests/[slug]/BuyTickets';
import { answerInvite, inviteToTeam, leaveEventTeam, removeTeamMember, submitTeam, withdrawMyEntry } from './actions';

export const metadata = { title: 'My events' };

type Entry = {
  reg_id: string; status: string; team_name: string | null; captain_id: string; title: string; event_id: string; starts_at: Date; venue: string;
  reg_deadline: Date; team_min: number; team_max: number; price_paise: number; slots: number; taken: number; tt_id: string;
  fest: string; slug: string; upi: boolean; pending: boolean; utr_sent: boolean; paid: boolean; refunded: boolean;
};
type Mem = { id: string; reg_id: string; name: string | null; email: string; status: string; is_captain: boolean; me: boolean; present: boolean };

export default async function MyEvents({ searchParams }: { searchParams: Promise<{ paid?: string; utr?: string }> }) {
  const user = await requireUser('student');
  const sp = await searchParams;
  if (!(await eventsReady())) return <div className="wrap"><h1 className="h2 mt8">My events</h1><div className="alert info mt16">{EVENTS_MISSING}</div></div>;
  const entries = await sql<Entry[]>`
    select r.id as reg_id, r.status, r.team_name, r.captain_id, e.title, e.id as event_id, e.starts_at, e.venue, e.reg_deadline, e.team_min, e.team_max,
           e.price_paise, e.slots, ${takenLive(sql)} as taken, tt.id as tt_id, f.name as fest, f.slug, (f.upi_enabled and f.upi_vpa is not null) as upi,
           -- a payment still inside its hold (15 min card / 30 min bank UPI; bank UPI with a UTR waits for the fest)
           exists (select 1 from orders o where o.registration_id = r.id and ${holdLive(sql)}) as pending,
           exists (select 1 from orders o where o.registration_id = r.id and o.status = 'pending' and o.utr is not null) as utr_sent,
           exists (select 1 from orders o where o.registration_id = r.id and o.status = 'paid') as paid,
           exists (select 1 from orders o where o.registration_id = r.id and o.status = 'refunded') as refunded
    from event_members m join event_regs r on r.id = m.reg_id join events e on e.id = r.event_id
    join ticket_types tt on tt.id = e.ticket_type_id join fests f on f.id = e.fest_id
    where m.user_id = ${user.id} and (m.status = 'joined' or (r.status = 'refunded' and r.captain_id = ${user.id}))
    order by e.starts_at`;
  const ids = entries.map((e) => e.reg_id);
  const members = ids.length ? await sql<Mem[]>`
    select m.id, m.reg_id, case when m.status = 'joined' then u.name end as name, m.email::text, m.status, (m.user_id = r.captain_id) as is_captain, (m.user_id = ${user.id}) as me,
           (m.checked_in_at is not null) as present
    from event_members m join event_regs r on r.id = m.reg_id left join users u on u.id = m.user_id
    where m.reg_id in ${sql(ids)} and m.status in ('joined', 'invited') order by m.invited_at` : [];
  const invites = await sql<{ id: string; title: string; fest: string; team_name: string | null; captain: string; team_min: number; team_max: number }[]>`
    select m.id, e.title, f.name as fest, r.team_name, u.name as captain, e.team_min, e.team_max
    from event_members m join event_regs r on r.id = m.reg_id join events e on e.id = m.event_id join fests f on f.id = e.fest_id join users u on u.id = r.captain_id
    where m.email = ${user.email} and m.status = 'invited' and r.status in ('forming', 'confirmed') order by m.invited_at desc`;
  const gw = activeGateway();
  const cfg = eventFees();
  const now = Date.now();

  return (
    <div className="wrap stack g16 ev-ui" style={{ maxWidth: 640 }}>
      <div className="row between g8 wrap-row mt8"><h1 className="h2">My events</h1><Link href="/tickets" className="btn sm outline">🎟️ My tickets</Link></div>
      {sp.paid && <div className="alert ok" role="status">Payment received — your entry is confirmed.</div>}
      {sp.utr && !sp.paid && <div className="alert info" role="status" data-utr-sent>UTR sent — we’ll confirm once the payment is seen in the fest’s account.</div>}
      <FlashMessage />
      {!user.verified && <div className="alert info">Confirm your email to accept team invites.</div>}

      {invites.length > 0 && (
        <section className="stack g8" id="invites">
          <h2 className="h3">Invites</h2>
          {invites.map((i) => (
            <div key={i.id} className="card tight stack g8" data-invite={i.title}>
              <div className="wrap-anywhere"><strong>{i.captain}</strong> invited you to {i.team_name ? <>“{i.team_name}” for </> : ''}<strong>{i.title}</strong> · {i.fest}</div>
              <div className="xs muted">{teamText(i.team_min, i.team_max)}</div>
              <div className="row g8 wrap-row">
                <ActionForm action={answerInvite} className="row g8" flash><input type="hidden" name="memberId" value={i.id} /><input type="hidden" name="answer" value="accept" /><Submit className="btn sm" pendingText="Joining…">Accept</Submit></ActionForm>
                <ActionForm action={answerInvite} className="row g8" flash><input type="hidden" name="memberId" value={i.id} /><input type="hidden" name="answer" value="decline" /><Submit className="btn sm outline" pendingText="…">Decline</Submit></ActionForm>
              </div>
            </div>
          ))}
        </section>
      )}

      {!entries.length && !invites.length && <Empty icon="🏆" title="No events yet">Open a fest and pick an event to register.</Empty>}

      {entries.map((e) => {
        const mem = members.filter((m) => m.reg_id === e.reg_id);
        const joined = mem.filter((m) => m.status === 'joined').length;
        const outstanding = mem.length;
        const captain = e.captain_id === user.id;
        const team = e.team_max > 1;
        const closed = e.reg_deadline.getTime() <= now;
        const full = e.taken >= e.slots;
        const label = e.status === 'confirmed' ? 'Confirmed' : e.status === 'refunded' || e.refunded ? 'Refunded' : e.status === 'withdrawn' ? 'Withdrawn'
          : e.pending ? 'Payment pending' : team ? `Forming ${joined}/${e.team_max}${joined < e.team_min ? ` — need ${e.team_min}` : ''}` : 'Not paid yet';
        const live = e.status === 'forming' || e.status === 'confirmed';
        return (
          <section key={e.reg_id} className="card stack g12" data-entry={e.title}>
            <div className="row between g8 wrap-row">
              <div style={{ minWidth: 0 }}><strong className="wrap-anywhere">{e.title}</strong><div className="xs muted">{e.fest} · {dayLabel(e.starts_at)} {time(e.starts_at)}{e.venue ? ` · ${e.venue}` : ''}</div></div>
              <span className={`badge ${e.status === 'confirmed' ? 'green' : e.status === 'forming' ? 'yellow' : 'gray'}`} data-status>{label}</span>
            </div>
            {team && <div className="xs soft">{e.team_name ? `“${e.team_name}” · ` : ''}{teamText(e.team_min, e.team_max)}</div>}
            {team && (
              <div className="list">
                {mem.map((m) => (
                  <div key={m.id} className="li" style={{ padding: '8px 12px' }} data-member={m.name ?? m.email}>
                    <span className="grow small wrap-anywhere">{m.name ?? m.email}{m.is_captain ? ' (captain)' : ''}{m.status === 'invited' ? <span className="xs muted"> · invited</span> : ''}{m.present ? ' ✓' : ''}</span>
                    {captain && !m.is_captain && live && (
                      <ActionForm action={removeTeamMember} className="row g8" flash><input type="hidden" name="memberId" value={m.id} />
                        <Submit className="btn text xs" pendingText="…">{m.status === 'invited' ? 'Cancel invite' : 'Remove'}</Submit></ActionForm>
                    )}
                  </div>
                ))}
              </div>
            )}

            {captain && live && team && !closed && outstanding < e.team_max && (
              <ActionForm action={inviteToTeam} className="row g8 wrap-row" resetOnSuccess flash>
                <input type="hidden" name="regId" value={e.reg_id} />
                <input className="input grow" type="email" name="email" required placeholder="teammate@college.edu" aria-label="Teammate’s email" style={{ minWidth: 0, flex: '1 1 180px' }} />
                <Submit className="btn sm" pendingText="Sending…">Invite</Submit>
              </ActionForm>
            )}

            {captain && e.status === 'forming' && !closed && !e.pending && (
              e.price_paise === 0 ? (
                <ActionForm action={submitTeam} flash>
                  <input type="hidden" name="regId" value={e.reg_id} />
                  <button className="btn block" type="submit" disabled={joined < e.team_min || full} data-submit>
                    {full ? 'Event is full' : joined < e.team_min ? `Submit team (need ${e.team_min - joined} more)` : 'Submit team'}
                  </button>
                </ActionForm>
              ) : joined < e.team_min || full ? (
                <button className="btn block" disabled data-pay>{full ? 'Event is full' : `Pay & submit (need ${e.team_min - joined} more)`}</button>
              ) : (
                <div data-pay-box>
                  <BuyTickets festSlug={e.slug} signedIn isStudent registrationId={e.reg_id}
                    types={[{ id: e.tt_id, name: team ? `${e.title} — team entry` : e.title, description: team ? 'One payment for the whole team' : '', price: e.price_paise, left: e.slots - e.taken }]}
                    feeCfg={cfg} gateway={gw} upiEnabled={e.upi}
                    hasPhone={!!user.phone && /^[6-9]\d{9}$/.test(user.phone.replace(/\D/g, '').slice(-10))}
                    prefill={{ name: user.name, email: user.email, contact: user.phone ?? '' }} />
                </div>
              )
            )}
            {e.pending && (e.utr_sent
              ? <p className="small soft">UTR sent — we’ll confirm once the payment is seen in the fest’s account.</p>
              : <p className="small soft">Payment in progress — finish it from <Link href="/tickets" className="accent">My tickets</Link> (bank UPI) or wait a few minutes. An unfinished payment is released after 15 minutes (30 for bank UPI).</p>)}
            {captain && e.paid && e.status === 'confirmed' && <p className="xs muted">Paid {rupees(e.price_paise)} + fee. Need to cancel? Ask the organizer for a refund.</p>}

            <div className="row g8 wrap-row">
              {!captain && live && !closed && (
                <ActionForm action={leaveEventTeam} className="row g8" flash><input type="hidden" name="regId" value={e.reg_id} /><Submit className="btn sm outline" pendingText="…">Leave team</Submit></ActionForm>
              )}
              {captain && live && !e.paid && !e.pending && (e.status === 'forming' || !closed) && (
                <ActionForm action={withdrawMyEntry} className="row g8" flash><input type="hidden" name="regId" value={e.reg_id} /><Submit className="btn sm outline" pendingText="…">Withdraw entry</Submit></ActionForm>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

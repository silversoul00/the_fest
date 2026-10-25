import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import type { ScheduleEvent } from '@/lib/types';
import { getUser } from '@/lib/auth';
import { festAccess } from '@/lib/fest-access';
import { getAnnouncements, getFestBySlug, getSchedule, getTicketTypes } from '@/lib/queries';
import { ago, dateRange, dayLabel, time } from '@/lib/format';
import { activeGateway, eventFees, feeConfig } from '@/lib/payments';
import { catLabel, FestStatus } from '@/components/ui';
import { BuyTickets } from './BuyTickets';
import { isRenameNote } from '@/lib/fest-form';
import { sql } from '@/lib/db';
import { eventsReady } from '@/lib/fest-access';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABEL, feeText, isEventCategory, slotState, teamText } from '@/lib/event-format';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const f = await getFestBySlug((await params).slug);
  if (!f) return {};
  return { title: f.name, description: `${f.name} at ${f.college}, ${f.city} · ${dateRange(f.starts_on, f.ends_on)}. ${f.description.slice(0, 120)}` };
}

export default async function FestPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cat?: string }> }) {
  const { slug } = await params;
  const { cat } = await searchParams;
  const fest = await getFestBySlug(slug);
  const user = await getUser();
  // Drafts and new fests waiting for approval are visible only to their organizer (preview) and THE FEST's admins.
  // A fest renamed after approval stays public while THE FEST re-checks it (Harshith, Oct 24): sales are paused, but
  // ticket holders still see dates, schedule and announcements.
  const runsIt = !!user && !!fest && (fest.organizer_id === user.id || !!(await festAccess(fest.id, user)));
  const renameCheck = !!fest && fest.status === 'review' && isRenameNote(fest.review_note);
  if (!fest || ((fest.status === 'draft' || (fest.status === 'review' && !renameCheck)) && !runsIt && !user?.is_admin)) notFound();

  const [types, schedule, news] = await Promise.all([getTicketTypes(fest.id, 'entry'), getSchedule(fest.id), getAnnouncements(fest.id, 5)]);
  // v2.8 events (hidden ones never show)
  const events = (await eventsReady()) ? await sql<{ id: string; title: string; category: string; starts_at: Date; venue: string; team_min: number; team_max: number; price_paise: number; needs_ticket: boolean; slots: number; taken: number; reg_deadline: Date }[]>`
    select e.id, e.title, e.category, e.starts_at, e.venue, e.team_min, e.team_max, e.price_paise, e.needs_ticket, e.slots, tt.sold as taken, e.reg_deadline
    from events e join ticket_types tt on tt.id = e.ticket_type_id where e.fest_id = ${fest.id} and e.active order by e.starts_at, e.title` : [];
  const cats = EVENT_CATEGORIES.filter((c) => events.some((e) => e.category === c));
  const pickedCat = isEventCategory(cat) && cats.includes(cat) ? cat : null;
  const shownEvents = pickedCat ? events.filter((e) => e.category === pickedCat) : events;

  // Group schedule by IST day
  const days = new Map<string, ScheduleEvent[]>();
  for (const ev of schedule) {
    const k = dayLabel(ev.starts_at);
    days.set(k, [...(days.get(k) ?? []), ev]);
  }

  const canBuy = fest.status === 'live';
  const isOwner = runsIt;

  return (
    <div style={{ '--fest': fest.accent, marginTop: -20 } as CSSProperties}>
      <div className="fest-banner" style={{ height: 220 }}>
        <span className="emoji" style={{ fontSize: 84 }}>{fest.emoji}</span>
      </div>

      <div className="wrap" style={{ marginTop: -36, position: 'relative', zIndex: 2 }}>
        {isOwner && (
          <div className="alert info mb16 row between g8 wrap-row">
            <span>You&apos;re viewing your fest{fest.status === 'draft' ? ' (draft — only you can see it)' : fest.status === 'review' ? (renameCheck ? ' (THE FEST is checking the new name — the page stays up, ticket sales are paused)' : ' (waiting for THE FEST approval — not public yet)') : ''}.</span>
            <Link href={`/organizer/${fest.id}`} className="accent">Back to dashboard →</Link>
          </div>
        )}
        {renameCheck && (
          <div className="alert info mb16" role="status" data-testid="under-review">
            <b>Under review — ticket sales paused.</b> The organizers changed this fest&apos;s details and THE FEST is checking them. Tickets already bought stay valid and work at the gate.
          </div>
        )}
        <div className="row g8 wrap-row">
          <FestStatus fest={fest} />
          <span className="badge gray">{catLabel(fest.category)}</span>
        </div>
        <div className="label mt16" style={{ color: 'var(--orange)' }}>{fest.college}</div>
        <h1 className="h1 mt8">{fest.name}</h1>
        <div className="row g16 wrap-row soft mt12 small">
          <span>📅 {dateRange(fest.starts_on, fest.ends_on)}</span>
          <span>📍 {fest.venue ? `${fest.venue}, ` : ''}{fest.city}</span>
        </div>

        <div className="stack g32 mt24" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
          <div className="stack g24">
            {fest.description && <p className="soft" style={{ fontSize: 16, whiteSpace: 'pre-line' }}>{fest.description}</p>}

            {news.length > 0 && (
              <section>
                <h2 className="h3 mb16">Announcements</h2>
                <div className="list">
                  {news.map((a) => (
                    <div key={a.id} className="li" style={{ alignItems: 'flex-start' }}>
                      <span>{a.urgent ? '🚨' : '📢'}</span>
                      <div className="grow">
                        <div className="row between g8"><strong className={a.urgent ? 'c-orange' : ''}>{a.title}</strong><span className="xs muted">{ago(a.created_at)}</span></div>
                        {a.body && <div className="small soft mt8">{a.body}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {events.length > 0 && (
              <section id="events" className="ev-ui">
                <h2 className="h3 mb16">Events</h2>
                <div className="row g8 wrap-row mb16" role="navigation" aria-label="Event categories">
                  <Link href={`/fests/${fest.slug}#events`} className={`badge ${pickedCat ? 'gray' : 'yellow'}`} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 14px' }} scroll={false}>All</Link>
                  {cats.map((c) => <Link key={c} href={`/fests/${fest.slug}?cat=${c}#events`} className={`badge ${pickedCat === c ? 'yellow' : 'gray'}`} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 14px' }} scroll={false} data-chip={c}>{EVENT_CATEGORY_LABEL[c]}</Link>)}
                </div>
                <div className="stack g12">
                  {shownEvents.map((e) => {
                    const st = slotState(e.taken, e.slots, e.reg_deadline);
                    return (
                      <Link key={e.id} href={`/fests/${fest.slug}/events/${e.id}`} className="card tight stack g4" style={{ background: 'var(--black)' }} data-event-card={e.title}>
                        <div className="row between g8"><strong className="wrap-anywhere">{e.title}</strong>
                          <span className={`badge ${st.kind === 'open' ? 'green' : st.kind === 'full' ? 'orange' : 'gray'}`} data-slots>{st.text}</span></div>
                        <div className="xs muted">{dayLabel(e.starts_at)} {time(e.starts_at)}{e.venue ? ` · ${e.venue}` : ''}</div>
                        <div className="xs soft"><span data-team>{teamText(e.team_min, e.team_max)}</span> · <span data-fee>{feeText(e.price_paise, e.needs_ticket, eventFees().flatPaise, e.team_max > 1)}</span></div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <h2 className="h3 mb16">Schedule</h2>
              {schedule.length === 0 ? (
                <p className="small muted">Schedule coming soon.</p>
              ) : (
                <div className="stack g16">
                  {[...days].map(([d, evs]) => (
                    <div key={d}>
                      <div className="label mb8">{d}</div>
                      <div className="list">
                        {evs.map((ev) => (
                          <div key={ev.id} className="li">
                            <span className="mono xs" style={{ width: 64, color: 'var(--yellow)' }}>{time(ev.starts_at)}</span>
                            <div className="grow">
                              <div>{ev.title}</div>
                              <div className="xs muted">{ev.venue} · till {time(ev.ends_at)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="card" style={{ position: 'sticky', top: 76 }} id="tickets">
            <h2 className="h3 mb16">Tickets</h2>
            {!canBuy ? (
              <p className="small muted">{fest.status === 'ended' ? 'This fest has ended.' : fest.status === 'cancelled' ? `This fest was cancelled${fest.cancelled_reason ? `: ${fest.cancelled_reason}` : ''}. Everyone who bought a ticket is refunded.` : renameCheck ? 'Ticket sales are paused while THE FEST checks this fest. They reopen once it’s approved.' : 'Tickets are not on sale yet.'}</p>
            ) : (
              <BuyTickets
                festSlug={fest.slug}
                signedIn={!!user}
                isStudent={user?.role === 'student'}
                types={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, description: t.description, price: t.price_paise, left: t.quota - t.sold }))}
                feeCfg={feeConfig()}
                gateway={activeGateway()}
                upiEnabled={!!(fest.upi_enabled && fest.upi_vpa)}
                hasPhone={!!user?.phone && /^[6-9]\d{9}$/.test(user.phone.replace(/\D/g, '').slice(-10))}
                prefill={user ? { name: user.name, email: user.email, contact: user.phone ?? '' } : null}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

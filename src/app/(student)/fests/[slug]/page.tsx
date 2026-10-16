import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import type { ScheduleEvent } from '@/lib/types';
import { getUser } from '@/lib/auth';
import { getAnnouncements, getFestBySlug, getSchedule, getTicketTypes } from '@/lib/queries';
import { ago, dateRange, dayLabel, time } from '@/lib/format';
import { activeGateway, feeConfig } from '@/lib/payments';
import { catLabel, FestStatus } from '@/components/ui';
import { BuyTickets } from './BuyTickets';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const f = await getFestBySlug((await params).slug);
  if (!f) return {};
  return { title: f.name, description: `${f.name} at ${f.college}, ${f.city} · ${dateRange(f.starts_on, f.ends_on)}. ${f.description.slice(0, 120)}` };
}

export default async function FestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fest = await getFestBySlug(slug);
  const user = await getUser();
  // Drafts are visible only to their organizer (preview)
  if (!fest || ((fest.status === 'draft' || fest.status === 'review') && fest.organizer_id !== user?.id && !user?.is_admin)) notFound();

  const [types, schedule, news] = await Promise.all([getTicketTypes(fest.id), getSchedule(fest.id), getAnnouncements(fest.id, 5)]);

  // Group schedule by IST day
  const days = new Map<string, ScheduleEvent[]>();
  for (const ev of schedule) {
    const k = dayLabel(ev.starts_at);
    days.set(k, [...(days.get(k) ?? []), ev]);
  }

  const canBuy = fest.status === 'live';
  const isOwner = user?.id === fest.organizer_id;

  return (
    <div style={{ '--fest': fest.accent, marginTop: -20 } as CSSProperties}>
      <div className="fest-banner" style={{ height: 220 }}>
        <span className="emoji" style={{ fontSize: 84 }}>{fest.emoji}</span>
      </div>

      <div className="wrap" style={{ marginTop: -36, position: 'relative', zIndex: 2 }}>
        {isOwner && (
          <div className="alert info mb16 row between g8 wrap-row">
            <span>You&apos;re viewing your fest{fest.status === 'draft' ? ' (draft — only you can see it)' : fest.status === 'review' ? ' (waiting for THE FEST approval — not public yet)' : ''}.</span>
            <Link href={`/organizer/${fest.id}`} className="accent">Back to dashboard →</Link>
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
              <p className="small muted">{fest.status === 'ended' ? 'This fest has ended.' : 'Tickets are not on sale yet.'}</p>
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

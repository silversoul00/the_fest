'use client';
import { useEffect, useState } from 'react';
import { LiveQR, SAVED_KEY, type SavedTicket } from '@/components/LiveQR';

/** Tickets opened on this phone before, shown with no signal (saved in this browser; cleared on logout). */
export function SavedTickets() {
  const [list, setList] = useState<[string, SavedTicket][] | null>(null);
  useEffect(() => {
    try { setList(Object.entries(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, SavedTicket>)); }
    catch { setList([]); }
  }, []);
  if (!list?.length) return null;
  return (
    <div className="stack g16" style={{ width: '100%' }} data-saved-tickets>
      <div className="h3">Your saved tickets</div>
      {list.map(([id, t]) => (
        <div key={id} className="ticket">
          <div className="ticket-top">
            <div className="display" style={{ fontSize: 30 }}>{t.fest}</div>
            <div className="small soft mt8">{t.type} · {t.date}</div>
          </div>
          <div className="ticket-perf" />
          <div className="ticket-qr"><LiveQR ticketId={id} url={t.url} secret={t.secret} /></div>
        </div>
      ))}
    </div>
  );
}

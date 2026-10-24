'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { liveCode } from '@/lib/qr2-client.ts';
import { b64u, liveStep, unb64u, LIVE_STEP_SECONDS } from '@/lib/qr2-format.ts';

/*
 * The ticket QR as shown on the student's phone. "Live" mode adds a code that changes every 30 seconds,
 * so THE FEST scanner can tell a live screen from an old screenshot (a warning only). "Static" is for printing.
 * Tickets shown here are saved on this phone so /offline can show them without signal (cleared on logout).
 */
export const SAVED_KEY = 'tf_tickets';
export const OFFLINE_CACHE = 'thefest-v3'; // keep in step with VERSION in public/sw.js
export type SavedTicket = { url: string; secret: string; fest: string; type: string; date: string; savedAt: number };

const QR_OPTS = { type: 'svg' as const, errorCorrectionLevel: 'M' as const, margin: 1, color: { dark: '#080808', light: '#F5F0E8' } };

/** Keep /offline (and the scripts it needs) in the cache, so the saved ticket opens with no signal. */
let warmed = false;
async function warmOffline() {
  if (warmed || !('caches' in window)) return;
  warmed = true;
  try {
    const res = await fetch('/offline');
    if (!res.ok) return;
    const html = await res.clone().text();
    const c = await caches.open(OFFLINE_CACHE);
    await c.put('/offline', res);
    const assets = new Set<string>();
    for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
    for (const m of html.matchAll(/(static\/(?:chunks|css)\/[^"\\]+\.(?:js|css))/g)) assets.add(`/_next/${m[1]}`);
    await Promise.all([...assets].map(async (a) => {
      if (await c.match(a)) return;
      const r = await fetch(a);
      if (r.ok) await c.put(a, r);
    }));
  } catch {}
}

export function LiveQR({ ticketId, url, secret, initialSvg, save }: {
  ticketId: string; url: string; secret: string; initialSvg?: string;
  save?: { fest: string; type: string; date: string };
}) {
  const [svg, setSvg] = useState(initialSvg ?? '');
  const [mode, setMode] = useState<'live' | 'static'>('live');
  const [left, setLeft] = useState(LIVE_STEP_SECONDS);

  useEffect(() => {
    if (!save) return;
    try {
      const all = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, SavedTicket>;
      all[ticketId] = { url, secret, ...save, savedAt: Date.now() };
      localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    } catch {}
    warmOffline();
  }, [ticketId, url, secret, save?.fest, save?.type, save?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let step = -1, stop = false;
    const key = unb64u(secret);
    const draw = async () => {
      const now = Date.now();
      setLeft(LIVE_STEP_SECONDS - (Math.floor(now / 1000) % LIVE_STEP_SECONDS));
      const s = liveStep(now);
      if (s === step) return;
      step = s;
      let text = url;
      if (mode === 'live' && key && globalThis.crypto?.subtle) text = `${url}.${b64u(await liveCode(key, s))}`;
      const out = await QRCode.toString(text, QR_OPTS);
      if (!stop) setSvg(out);
    };
    draw();
    const id = mode === 'live' ? setInterval(draw, 1000) : undefined;
    return () => { stop = true; clearInterval(id); };
  }, [url, secret, mode]);

  const r = 9, C = 2 * Math.PI * r;
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: svg }} aria-label="Ticket QR code" role="img" data-mode={mode} />
      <div className="row g8" style={{ alignItems: 'center', color: 'rgba(8,8,8,.7)' }}>
        {mode === 'live' ? (
          <>
            <svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }} aria-hidden>
              <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(8,8,8,.15)" strokeWidth="3" />
              <circle cx="12" cy="12" r={r} fill="none" stroke="#080808" strokeWidth="3" strokeDasharray={C}
                strokeDashoffset={C * (1 - left / LIVE_STEP_SECONDS)} transform="rotate(-90 12 12)" />
            </svg>
            <span className="xs" data-countdown>Live QR · changes in {left}s</span>
          </>
        ) : <span className="xs">Static QR — fine for printing</span>}
        <button type="button" className="btn text xs" style={{ color: '#080808', textDecoration: 'underline' }}
          onClick={() => setMode(mode === 'live' ? 'static' : 'live')}>
          {mode === 'live' ? 'Static QR (for print)' : 'Back to live QR'}
        </button>
      </div>
    </>
  );
}

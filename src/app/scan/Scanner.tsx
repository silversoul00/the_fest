'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

type Counts = { inn: number; total: number; mine: number };
type Counter = 'gate' | 'lunch' | 'stay';
type Verdict = {
  result: 'admitted' | 'duplicate' | 'invalid' | 'wrong_fest' | 'void';
  message: string; holder?: string; type?: string; code?: string; checkedInAt?: string; gate?: string | null;
  counts?: Counts; error?: string;
};
type FeedItem = Verdict & { at: number };

const TITLE: Record<Counter, Record<Verdict['result'], string>> = {
  gate: { admitted: '✓ Admit', duplicate: '⚠ Already in', invalid: '✕ Invalid', wrong_fest: '✕ Wrong fest', void: '✕ Cancelled' },
  lunch: { admitted: '✓ Lunch', duplicate: '⚠ Already had lunch', invalid: '✕ No lunch', wrong_fest: '✕ Wrong fest', void: '✕ Cancelled' },
  stay: { admitted: '✓ Stay', duplicate: '⚠ Stay done', invalid: '✕ No stay', wrong_fest: '✕ Wrong fest', void: '✕ Cancelled' },
};
const COUNTER_LABEL: Record<Counter, string> = { gate: 'Gate', lunch: 'Lunch counter', stay: 'Stay desk' };

declare class BarcodeDetector {
  constructor(o: { formats: string[] });
  detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

function feedback(ok: boolean) {
  try { navigator.vibrate?.(ok ? 80 : [120, 60, 120]); } catch {}
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square';
    g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.15 : 0.35));
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 600);
  } catch {}
}

export function Scanner({ counter, canPick, fests, festId, festName, defaultGate, volunteer, initialCounts, lockAction }: {
  counter: Counter; canPick: boolean;
  fests: { id: string; name: string; duty: string | null }[]; festId: string; festName: string; defaultGate: string;
  volunteer: string; initialCounts: Counts; lockAction: () => Promise<void>;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busy = useRef(false);
  const last = useRef<{ v: string; t: number }>({ v: '', t: 0 });
  const [gate, setGate] = useState(defaultGate);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unsupported'>('off');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [counts, setCounts] = useState(initialCounts);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [code, setCode] = useState('');
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up(); window.addEventListener('online', up); window.addEventListener('offline', up);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up); };
  }, []);

  const submit = useCallback(async (data: { payload?: string; code?: string }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ festId, gate, counter, ...data }) });
      if (r.status === 401) { router.replace('/scan/login'); return; }
      const v: Verdict = await r.json();
      if (!r.ok) { setVerdict({ result: 'invalid', message: v.error ?? 'Scan failed' }); feedback(false); return; }
      setVerdict(v);
      if (v.counts) setCounts(v.counts);
      setFeed((f) => [{ ...v, at: Date.now() }, ...f].slice(0, 12));
      feedback(v.result === 'admitted');
    } catch {
      setVerdict({ result: 'invalid', message: 'No connection — check Wi-Fi/data and scan again' });
      feedback(false);
    } finally {
      // Hold the verdict on screen so the volunteer can read it
      setTimeout(() => { busy.current = false; }, 1400);
    }
  }, [festId, gate, counter, router]);

  // Camera loop
  useEffect(() => {
    if (camera !== 'on') return;
    let stream: MediaStream | null = null;
    let raf = 0; let stopped = false;
    const detector = typeof BarcodeDetector !== 'undefined' ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        const v = videoRef.current!;
        v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play();
      } catch {
        setCamera('denied'); return;
      }
      let lastTick = 0;
      const tick = async (t: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (t - lastTick < 140 || busy.current) return;
        lastTick = t;
        const v = videoRef.current, c = canvasRef.current;
        if (!v || !c || v.readyState < 2) return;
        let value: string | null = null;
        if (detector) {
          try { value = (await detector.detect(v))[0]?.rawValue ?? null; } catch {}
        } else {
          const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * 480) || 480;
          c.width = w; c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, w, h);
          value = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
        }
        if (value) {
          const now = Date.now();
          // Same ticket still in frame. Lunch/stay desks wait longer so a held-up QR isn't used twice (stay: in, then out).
          if (value === last.current.v && now - last.current.t < (counter === 'gate' ? 4000 : 60000)) return;
          last.current = { v: value, t: now };
          submit({ payload: value });
        }
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera, submit, counter]);

  function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('unsupported'); return; }
    setCamera('on');
  }

  const pct = counts.total ? Math.round((counts.inn / counts.total) * 100) : 0;

  return (
    <div className="scan-shell" style={{ ['--accent' as string]: 'var(--green)' }}>
      <header className="topbar">
        <div className="wrap topbar-in">
          <span className="logo" style={{ fontSize: 20, color: 'var(--green)' }}>{counter === 'gate' ? 'GATE SCANNER' : COUNTER_LABEL[counter].toUpperCase()}</span>
          <form action={lockAction}><button className="btn sm outline" type="submit">🔒 Lock</button></form>
        </div>
      </header>

      {!online && <div className="alert error" style={{ textAlign: 'center' }}>Offline — scans need internet to stop duplicate entries.</div>}

      <main className="wrap stack g16" style={{ padding: '16px var(--gutter) 40px', maxWidth: 520 }}>
        <div className="row g8">
          {fests.length > 1 ? (
            <select className="select grow" value={festId} onChange={(e) => router.replace(`/scan?fest=${e.target.value}`)} aria-label="Fest">
              {fests.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : <div className="grow display" style={{ fontSize: 24 }}>{festName}</div>}
          {counter === 'gate' && <select className="select" style={{ width: 130 }} value={gate} onChange={(e) => setGate(e.target.value)} aria-label="Gate">
            {['Gate 1', 'Gate 2', 'Gate 3', 'Gate 4', 'VIP Gate'].concat(gate && !gate.startsWith('Gate') && gate !== 'VIP Gate' ? [gate] : []).map((g) => <option key={g}>{g}</option>)}
          </select>}
        </div>

        <div className="row g8" style={{ alignItems: 'center' }}>
          <div className="grow display" style={{ fontSize: 30, color: counter === 'gate' ? 'var(--green)' : 'var(--yellow)' }} data-counter={counter}>{COUNTER_LABEL[counter]}</div>
          {canPick && (
            <select className="select" style={{ width: 150 }} value={counter} aria-label="Counter"
              onChange={(e) => router.replace(`/scan?fest=${festId}&counter=${e.target.value}`)}>
              {(['gate', 'lunch', 'stay'] as const).map((c) => <option key={c} value={c}>{COUNTER_LABEL[c]}</option>)}
            </select>
          )}
        </div>

        {counter !== 'gate' ? (
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <div className="stat" style={{ ['--stat' as string]: 'var(--yellow)', padding: 12 }}><div className="label">{counter === 'lunch' ? 'Lunches today' : 'Stay scans today'}</div><div className="v" style={{ fontSize: 30 }}>{counts.inn}</div></div>
            <div className="stat" style={{ ['--stat' as string]: 'var(--blue)', padding: 12 }}><div className="label">By you</div><div className="v" style={{ fontSize: 30 }}>{counts.mine}</div></div>
          </div>
        ) : <>
        <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="stat" style={{ ['--stat' as string]: 'var(--green)', padding: 12 }}><div className="label">Inside</div><div className="v" style={{ fontSize: 30 }}>{counts.inn}</div></div>
          <div className="stat" style={{ ['--stat' as string]: 'var(--yellow)', padding: 12 }}><div className="label">Tickets</div><div className="v" style={{ fontSize: 30 }}>{counts.total}</div></div>
          <div className="stat" style={{ ['--stat' as string]: 'var(--blue)', padding: 12 }}><div className="label">By you</div><div className="v" style={{ fontSize: 30 }}>{counts.mine}</div></div>
        </div>
        <div className="bar"><i style={{ width: `${pct}%`, background: 'var(--green)' }} /></div>
        </>}

        <div className="viewfinder">
          {camera === 'on' ? (
            <>
              <video ref={videoRef} muted playsInline />
              <div className="frame" /><div className="laser" />
            </>
          ) : (
            <div className="stack g12" style={{ height: '100%', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 44 }}>📷</div>
              {camera === 'denied' && <p className="small c-red">Camera blocked. Allow camera access in your browser settings, or type codes below.</p>}
              {camera === 'unsupported' && <p className="small c-red">This browser can&apos;t open the camera. Use Chrome or Safari, or type codes below.</p>}
              <button className="btn green" onClick={startCamera}>Start camera</button>
            </div>
          )}
          <canvas ref={canvasRef} hidden />
        </div>

        {verdict && (
          <div className={`verdict ${verdict.result}`} role="status" aria-live="assertive" onClick={() => setVerdict(null)}>
            <div className="big">{TITLE[counter][verdict.result]}</div>
            {verdict.holder && <div className="mt8" style={{ color: 'var(--white)', fontSize: 18 }}>{verdict.holder}</div>}
            <div className="small mt8">
              {verdict.type ? `${verdict.type} · ` : ''}{verdict.message}
              {verdict.result === 'duplicate' && verdict.checkedInAt && ` at ${new Date(verdict.checkedInAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}${verdict.gate ? ` (${verdict.gate})` : ''}`}
            </div>
          </div>
        )}

        <form className="row g8" onSubmit={(e) => { e.preventDefault(); if (code.trim()) { submit({ code }); setCode(''); } }}>
          <input className="input grow mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="TF-XXXX-XXXX" aria-label="Ticket code" autoCapitalize="characters" autoComplete="off" />
          <button className="btn green" type="submit">Check</button>
        </form>

        {feed.length > 0 && (
          <div className="list">
            {feed.map((f) => (
              <div key={f.at} className="li" style={{ padding: '10px 14px' }}>
                <span className={`badge ${f.result === 'admitted' ? 'green' : f.result === 'duplicate' ? 'orange' : 'red'}`}>{f.result === 'admitted' ? (counter === 'gate' ? 'IN' : 'OK') : f.result === 'duplicate' ? 'DUP' : 'NO'}</span>
                <span className="grow truncate small">{f.holder ?? f.message}</span>
                <span className="xs muted mono">{new Date(f.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
        <p className="xs muted" style={{ textAlign: 'center' }}>Signed in as {volunteer} · scanner locks when the browser closes</p>
      </main>
    </div>
  );
}

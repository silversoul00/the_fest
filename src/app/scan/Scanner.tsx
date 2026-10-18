'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { importBundle, openTicket, type Bundle, type KeysJson, type LiveState, type Opened } from '@/lib/qr2-client.ts';
import { lunchToday, splitTf2 } from '@/lib/qr2-format.ts';
import { idbAll, idbClear, idbDel, idbGet, idbPut, type Queued } from './offline-store';

type Counts = { inn: number; total: number; mine: number };
type Counter = 'gate' | 'lunch' | 'stay';
type Verdict = {
  result: 'admitted' | 'duplicate' | 'invalid' | 'wrong_fest' | 'void' | 'offline';
  message: string; holder?: string; type?: string; code?: string; checkedInAt?: string; gate?: string | null;
  live?: LiveState | null; counts?: Counts; error?: string;
};
type FeedItem = Verdict & { at: number; note?: string };
type Card = Extract<Opened, { kind: 'ok' | 'tf1' }>;

const TITLE: Record<Counter, Record<Verdict['result'], string>> = {
  gate: { admitted: '✓ Admit', duplicate: '⚠ Already in', invalid: '✕ Invalid', wrong_fest: '✕ Wrong fest', void: '✕ Cancelled', offline: '✓ Admit (offline)' },
  lunch: { admitted: '✓ Lunch', duplicate: '⚠ Already had lunch', invalid: '✕ No lunch', wrong_fest: '✕ Wrong fest', void: '✕ Cancelled', offline: '✓ Lunch (offline)' },
  stay: { admitted: '✓ Stay', duplicate: '⚠ Already checked out', invalid: '✕ No stay', wrong_fest: '✕ Wrong fest', void: '✕ Cancelled', offline: '✓ Stay (offline)' },
};
const COUNTER_LABEL: Record<Counter, string> = { gate: 'Gate', lunch: 'Lunch counter', stay: 'Stay desk' };
const LIVE_LABEL: Record<LiveState, string> = { live: 'Live ✓', stale: 'Old screenshot', static: 'Static (print/screenshot)' };
const istDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const todayIST = () => istDay(Date.now());
const RETRY_MS = 30_000;
const looksLikePayload = (v: string) => /^TF1\./i.test(v.trim()) || /\/t\/[A-Za-z0-9_-]/.test(v);

/** Wipe this phone's offline keys (Lock, logout, 401). Queued scans stay; each one only syncs when the volunteer who made it logs in again. */
export async function wipeScannerKeys() { try { await idbClear('keys'); } catch {} }

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

export function Scanner({ counter, canPick, fests, festId, festName, defaultGate, volunteer, scannerId, initialCounts, lockAction }: {
  counter: Counter; canPick: boolean;
  fests: { id: string; name: string; duty: string | null }[]; festId: string; festName: string; defaultGate: string;
  volunteer: string; scannerId: string; initialCounts: Counts; lockAction: () => Promise<void>;
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
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [queued, setQueued] = useState(0);
  const [others, setOthers] = useState(0);
  const syncing = useRef(false);

  const applyBundle = (b: Bundle | null) => { bundleRef.current = b; setBundle(b); };
  const locked = useCallback(async () => { await wipeScannerKeys(); router.replace('/scan/login'); }, [router]);
  const countQueue = () => idbAll<Queued>('queue').then((q) => {
    const mine = q.filter((x) => x.value.by === scannerId).length;
    setQueued(mine); setOthers(q.length - mine);
    return mine;
  }).catch(() => 0);

  // Send scans saved offline. The server decides; a ticket used at another gate shows "Synced: was already used".
  // A queued scan is removed only after a clear answer from our server (a verdict, or a 400/403 refusal). A timeout,
  // 5xx, 429 or a Wi-Fi login page (not JSON) keeps it and stops — the timer below tries again.
  // Only this volunteer's own scans are sent, so they are never counted under someone else's name.
  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      for (const { key, value: q } of await idbAll<Queued>('queue')) {
        if (q.by !== scannerId) continue;
        const note0 = (v: Partial<Verdict>, note: string) =>
          setFeed((f) => [{ ...v, result: v.result ?? 'invalid', message: v.message ?? '', at: Date.now() + Math.random(), note }, ...f].slice(0, 12));
        // Lunch is per day: a lunch saved offline yesterday must not use up today's lunch.
        if (q.counter === 'lunch' && istDay(q.at) !== todayIST()) {
          await idbDel('queue', key);
          note0({ result: 'invalid' }, `Not recorded: lunch from ${istDay(q.at)} (synced on a later day)`);
          continue;
        }
        let r: Response;
        try {
          r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ festId: q.festId, gate: q.gate, counter: q.counter, payload: q.payload }), signal: timeoutSignal(8000) });
        } catch { break; }
        if (r.status === 401) { await locked(); break; }
        const isJson = (r.headers.get('content-type') ?? '').includes('application/json');
        const v = isJson ? await r.json().catch(() => null) as (Verdict | null) : null;
        const verdict = r.ok && v && typeof v.result === 'string';
        const refused = (r.status === 400 || r.status === 403) && v && typeof v.error === 'string';
        if (!verdict && !refused) break; // not a clear answer: keep this and the rest for the next try
        await idbDel('queue', key);
        const note = !verdict ? `Not accepted: ${v!.error}`
          : v!.result === 'admitted' ? `Synced ✓ ${v!.holder ?? ''}`
          : v!.result === 'duplicate' ? `Synced: was already used${v!.gate ? ` at ${v!.gate}` : ''}${v!.checkedInAt ? ` ${new Date(v!.checkedInAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''} — ${v!.holder ?? ''}`
          : `Synced: ${v!.message ?? 'not accepted'}`;
        note0({ ...v!, message: v!.message ?? v!.error ?? '' }, note);
        if (v!.counts && q.festId === festId) setCounts(v!.counts);
      }
    } finally {
      syncing.current = false;
      countQueue();
    }
  }, [festId, locked, scannerId]);

  // Retry on a timer while scans wait: "online" may never fire when the phone has Wi-Fi but a login page blocks it.
  useEffect(() => {
    const id = setInterval(() => { if (navigator.onLine) countQueue().then((n) => { if (n) sync(); }); }, RETRY_MS);
    return () => clearInterval(id);
  }, [sync]);

  /** Lock: send this volunteer's waiting scans first; if some can't go yet, say so before locking. */
  const lock = async () => {
    await sync();
    const left = await countQueue();
    if (left && !window.confirm(`${left} scan${left > 1 ? 's' : ''} not synced yet. ${left > 1 ? 'They stay' : 'It stays'} on this phone and ${left > 1 ? 'sync' : 'syncs'} next time ${volunteer} logs in here. Lock anyway?`)) return;
    await wipeScannerKeys();
    await lockAction();
  };

  useEffect(() => {
    const up = () => { setOnline(navigator.onLine); if (navigator.onLine) sync(); };
    up(); window.addEventListener('online', up); window.addEventListener('offline', up);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up); };
  }, [sync]);

  // Offline keys: cached copy first, then a fresh one from the server (on open and every 10 minutes while online)
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (navigator.onLine) {
        try {
          const r = await fetch(`/api/scan/keys?festId=${festId}`, { cache: 'no-store' });
          if (r.status === 401) { await locked(); return; }
          if (r.ok) {
            const b = await importBundle(await r.json() as KeysJson);
            await idbPut('keys', b, festId);
            if (!stop) applyBundle(b);
            return;
          }
          if (r.status === 403) { await idbDel('keys', festId); if (!stop) applyBundle(null); return; }
        } catch {}
      }
      const cached = await idbGet<Bundle>('keys', festId).catch(() => undefined);
      if (cached && cached.expiresAt > Date.now()) { if (!stop) applyBundle(cached); }
      else if (cached) await idbDel('keys', festId).catch(() => {});
    };
    load(); countQueue();
    const id = setInterval(() => { if (navigator.onLine) load(); }, 10 * 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [festId, locked]);

  const show = useCallback((v: Verdict, ok: boolean) => {
    setVerdict(v);
    setFeed((f) => [{ ...v, at: Date.now() }, ...f].slice(0, 12));
    feedback(ok);
  }, []);

  /** Offline: decide on this phone and queue the scan for later (gate/lunch/stay). */
  const offline = useCallback(async (text: string, opened: Opened | null) => {
    const b = bundleRef.current;
    if (!b || !opened) return show({ result: 'invalid', message: 'No connection — and this phone has no offline keys yet. Open the scanner while online first.' }, false);
    if (opened.kind === 'other') return show({ result: 'invalid', message: 'Not a THE FEST ticket' }, false);
    if (opened.kind === 'tampered') return show({ result: 'invalid', message: 'Fake or tampered ticket' }, false);
    if (opened.kind === 'wrong_fest') return show({ result: 'wrong_fest', message: 'Not a ticket for this fest' }, false);
    if (opened.kind === 'needs_network') return show({ result: 'invalid', message: 'Can’t read offline — needs network' }, false);
    if (opened.kind === 'tf1' && counter !== 'gate') return show({ result: 'invalid', message: 'Old-style ticket — needs network at this counter' }, false);

    const once = async (slot: string, okMsg: string, dupMsg: string) => {
      const key = `${festId}:${opened.ticketId}:${slot}`;
      if (await idbGet('seen', key)) { show({ result: 'duplicate', message: dupMsg }, false); return false; }
      await idbPut('seen', Date.now(), key);
      await idbPut('queue', { festId, gate, counter, payload: text, at: Date.now(), by: scannerId } satisfies Queued);
      countQueue();
      show({ result: 'offline', message: okMsg }, true);
      return true;
    };
    if (counter === 'gate') return void once('gate', 'Offline ✓ — saved, will sync', 'Already in (this phone)');
    if (opened.kind !== 'ok') return;
    if (counter === 'lunch') {
      const l = lunchToday(opened.lunch ?? 0, b.startsOn, todayIST());
      if (!l.ok) return show({ result: 'invalid', message: 'No lunch today' }, false);
      return void once(`lunch:${todayIST()}`, `Lunch ✓ (day ${l.x} of ${l.total}) — saved, will sync`, 'Lunch already taken today (this phone)');
    }
    if (!opened.stay) return show({ result: 'invalid', message: 'No stay on this ticket' }, false);
    if (!(await idbGet('seen', `${festId}:${opened.ticketId}:stay_in`))) return void once('stay_in', 'Stay: checked in — saved, will sync', '');
    return void once('stay_out', 'Stay: checked out — saved, will sync', 'Already checked out (this phone)');
  }, [festId, gate, counter, show, scannerId]);

  const submit = useCallback(async (data: { payload?: string; code?: string }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const b = bundleRef.current;
      const opened = data.payload && b ? await openTicket(data.payload, b) : null;
      setCard(opened && (opened.kind === 'ok' || opened.kind === 'tf1') ? opened : null);
      if (navigator.onLine) {
        try {
          const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ festId, gate, counter, ...data }) });
          if (r.status === 401) { await locked(); return; }
          const v: Verdict = await r.json();
          if (!r.ok) { setVerdict({ result: 'invalid', message: v.error ?? 'Scan failed' }); feedback(false); return; }
          if (v.counts) setCounts(v.counts);
          show(v, v.result === 'admitted');
          // Remember gate entries on this phone too, so an offline re-scan later says "Already in"
          if (counter === 'gate' && opened && (opened.kind === 'ok' || opened.kind === 'tf1') && (v.result === 'admitted' || v.result === 'duplicate')) {
            idbPut('seen', Date.now(), `${festId}:${opened.ticketId}:gate`).catch(() => {});
          }
          return;
        } catch { /* network dropped: decide offline below */ }
      }
      if (data.code) return show({ result: 'invalid', message: 'Backup codes need internet — scan the QR instead' }, false);
      await offline(data.payload!, opened);
    } finally {
      // Hold the verdict on screen so the volunteer can read it
      setTimeout(() => { busy.current = false; }, 1400);
    }
  }, [festId, gate, counter, locked, offline, show]);

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
          const id = splitTf2(value)?.p ?? value;
          // Same ticket still in frame. Lunch/stay desks wait longer so a held-up QR isn't used twice (stay: in, then out).
          if (id === last.current.v && now - last.current.t < (counter === 'gate' ? 4000 : 60000)) return;
          last.current = { v: id, t: now };
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
          <form action={lock}><button className="btn sm outline" type="submit">🔒 Lock</button></form>
        </div>
      </header>

      {!online && (bundle
        ? <div className="alert info" style={{ textAlign: 'center' }} role="status">Offline — scans are saved on this phone and sync when you’re back online.</div>
        : <div className="alert error" style={{ textAlign: 'center' }}>Offline — scans need internet to stop duplicate entries.</div>)}

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
            <select className="select" style={{ minWidth: 150 }} value={counter} aria-label="Counter"
              onChange={(e) => router.replace(`/scan?fest=${festId}&counter=${e.target.value}`)}>
              {(['gate', 'lunch', 'stay'] as const).map((c) => <option key={c} value={c}>{COUNTER_LABEL[c]}</option>)}
            </select>
          )}
        </div>

        {bundle && <p className="xs c-green" data-offline-ready>Offline ready — keep this page open{queued ? ` · ${queued} scan${queued > 1 ? 's' : ''} waiting to sync` : ''}</p>}
        {queued > 0 && online && <button className="btn sm outline" type="button" data-sync-now onClick={() => sync()}>Sync {queued} waiting scan{queued > 1 ? 's' : ''} now</button>}
        {others > 0 && <p className="xs muted" data-others-queued>{others} scan{others > 1 ? 's' : ''} saved by another volunteer on this phone — they sync when that volunteer logs in here.</p>}
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
            <div className="big">{counter === 'stay' && verdict.result === 'duplicate' && verdict.message.startsWith('Just checked in') ? '⚠ Just checked in' : TITLE[counter][verdict.result]}</div>
            {verdict.holder && <div className="mt8" style={{ color: 'var(--white)', fontSize: 18 }}>{verdict.holder}</div>}
            <div className="small mt8">
              {verdict.type ? `${verdict.type} · ` : ''}{verdict.message}
              {verdict.result === 'duplicate' && verdict.checkedInAt && ` at ${new Date(verdict.checkedInAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}${verdict.gate ? ` (${verdict.gate})` : ''}`}
            </div>
            {card && <RoleCard card={card} live={verdict.live ?? (card.kind === 'ok' ? card.live : null)} startsOn={bundle?.startsOn ?? ''} showName={!verdict.holder} />}
          </div>
        )}

        {/* Typed backup code, or a handheld (keyboard) QR scanner typing the ticket link */}
        <form className="row g8" onSubmit={(e) => { e.preventDefault(); const v = code.trim(); if (v) { submit(looksLikePayload(v) ? { payload: v } : { code: v }); setCode(''); } }}>
          <input className="input grow mono" value={code} onChange={(e) => setCode(e.target.value)} style={{ textTransform: looksLikePayload(code) ? 'none' : 'uppercase' }} placeholder="TF-XXXX-XXXX" aria-label="Ticket code" autoCapitalize="characters" autoComplete="off" />
          <button className="btn green" type="submit">Check</button>
        </form>

        {feed.length > 0 && (
          <div className="list">
            {feed.map((f) => (
              <div key={f.at} className="li" style={{ padding: '10px 14px' }}>
                <span className={`badge ${f.result === 'admitted' ? 'green' : f.result === 'duplicate' ? 'orange' : f.result === 'offline' ? 'yellow' : 'red'}`}>{f.result === 'admitted' ? (counter === 'gate' ? 'IN' : 'OK') : f.result === 'duplicate' ? 'DUP' : f.result === 'offline' ? 'SAVED' : 'NO'}</span>
                <span className="grow truncate small">{f.note ?? f.holder ?? f.message}</span>
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

/** What this phone could open from the sealed sections — only the roles it holds keys for. */
function RoleCard({ card, live, startsOn, showName }: { card: Card; live: LiveState | null | undefined; startsOn: string; showName: boolean }) {
  if (card.kind === 'tf1') return <div className="small mt8" data-role="tf1">Old-style ticket — no sealed details</div>;
  const lunch = card.lunch !== undefined && startsOn ? lunchToday(card.lunch, startsOn, todayIST()) : null;
  return (
    <div className="stack g8 mt12" style={{ color: 'var(--white)', textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
      {card.gate && (
        <div data-role="gate">
          {showName && <div style={{ fontSize: 18 }}>{card.gate.name}</div>}
          <div className="row g8 small"><span className="grow">{card.gate.type}</span>
            {live && <span className={`badge ${live === 'live' ? 'green' : live === 'stale' ? 'red' : 'gray'}`} data-live={live}>{LIVE_LABEL[live]}</span>}</div>
        </div>
      )}
      {lunch && <div data-role="lunch" className="small">{lunch.ok ? `Lunch today ✓ (day ${lunch.x} of ${lunch.total})` : 'No lunch today ✕'}</div>}
      {card.stay !== undefined && <div data-role="stay" className="small">Stay: {card.stay ? 'yes' : 'no'}</div>}
      {card.org && <div data-role="org" className="small">Holder phone: <a href={`tel:${card.org}`}>{card.org}</a></div>}
    </div>
  );
}

/** An abort signal that fires after `ms`; works on older phones that lack AbortSignal.timeout (Chrome < 103, iOS < 16). */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

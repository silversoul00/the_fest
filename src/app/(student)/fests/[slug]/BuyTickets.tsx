'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { rupees } from '@/lib/format';
import { quote, type FeeConfig, type Method } from '@/lib/pricing';

type T = { id: string; name: string; description: string; price: number; left: number };
type Gateway = 'cashfree' | 'razorpay' | 'demo' | 'none';
type Upi = { orderId: string; amount: number; vpa: string; payee: string; note: string; link: string };

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
    Cashfree?: (opts: { mode: string }) => { checkout: (o: { paymentSessionId: string; redirectTarget: string }) => Promise<{ error?: { message?: string }; paymentDetails?: unknown; redirect?: boolean }> };
  }
}

function loadScript(src: string, ready: () => boolean): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(ready()); s.onerror = () => res(false);
    document.body.appendChild(s);
  });
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Please try again.'), { status: r.status });
  return j;
}

export function BuyTickets({ festSlug, signedIn, isStudent, types, feeCfg, gateway, upiEnabled, hasPhone, prefill, addonFor, registrationId }: {
  festSlug: string; signedIn: boolean; isStudent: boolean; types: T[]; feeCfg: FeeConfig; gateway: Gateway; upiEnabled: boolean; hasPhone: boolean;
  prefill: { name: string; email: string; contact: string } | null;
  /** Buying a lunch/stay add-on for this ticket (from the ticket page): one per ticket, no quantity. */
  addonFor?: string;
  /** Paying for an event entry (v2.8, captain pays once per team): one unit, the server finds the event from the entry. */
  registrationId?: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState(types.find((t) => t.left > 0)?.id ?? '');
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<Method>(upiEnabled ? 'upi_direct' : 'gateway');
  // With card checkout off, bank UPI is the only way to pay
  useEffect(() => { if (gateway === 'none' && upiEnabled) setMethod('upi_direct'); }, [gateway, upiEnabled]);
  const [phone, setPhone] = useState('');
  const [needPhone, setNeedPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState<{ orderId: string; amount: number } | null>(null);
  const [upi, setUpi] = useState<Upi | null>(null);

  const t = types.find((x) => x.id === sel);
  const single = !!(addonFor || registrationId);
  const maxQty = single ? 1 : Math.min(10, t?.left ?? 0);
  const q = t ? quote(t.price, qty, feeCfg, method) : null;
  const done = (orderId: string) => {
    if (addonFor) { router.push(`/tickets/${addonFor}?addon=1`); router.refresh(); return; }
    if (registrationId) { router.push('/my-events?paid=1'); router.refresh(); return; }
    router.push(`/tickets?order=${orderId}`);
  };

  async function buy() {
    if (!t) return;
    if (method === 'gateway' && gateway === 'cashfree' && !hasPhone && !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, '').slice(-10))) {
      setNeedPhone(true); setErr('Add your mobile number — the payment page needs it.'); return;
    }
    setBusy(true); setErr('');
    try {
      const r = await post('/api/checkout', registrationId ? { registrationId, qty: 1, method, phone: phone || undefined } : { ticketTypeId: t.id, qty, method, phone: phone || undefined, ticketId: addonFor });
      if (r.mode === 'done') return done(r.orderId);
      if (r.mode === 'demo') { setDemo({ orderId: r.orderId, amount: r.amount }); setBusy(false); return; }
      if (r.mode === 'upi') { setUpi(r); setBusy(false); return; }
      if (r.mode === 'cashfree') {
        if (!(await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js', () => !!window.Cashfree)) || !window.Cashfree) throw new Error('Could not load the payment window. Check your connection.');
        const cf = window.Cashfree({ mode: r.env });
        const res = await cf.checkout({ paymentSessionId: r.paymentSessionId, redirectTarget: '_modal' });
        if (res.error) {
          await post('/api/checkout/cancel', { orderId: r.orderId }).catch(() => {});
          throw new Error(res.error.message || 'Payment was not completed. No money was taken.');
        }
        const v = await post('/api/checkout/cashfree-verify', { orderId: r.orderId });
        if (v.paid) return done(r.orderId);
        throw new Error('Payment not confirmed yet. If money was taken, your ticket appears in My Tickets within a few minutes.');
      }
      if (r.mode === 'razorpay') {
        if (!(await loadScript('https://checkout.razorpay.com/v1/checkout.js', () => !!window.Razorpay)) || !window.Razorpay) throw new Error('Could not load the payment window. Check your connection.');
        const rzp = new window.Razorpay({
          key: r.keyId, order_id: r.rzpOrderId, amount: r.amount, currency: 'INR',
          name: 'THE FEST', description: `${qty} × ${t.name}`, prefill: prefill ?? undefined, theme: { color: '#FFE034' },
          handler: async (resp: Record<string, string>) => {
            try { await post('/api/checkout/verify', { orderId: r.orderId, ...resp }); done(r.orderId); }
            catch (e) { setErr((e as Error).message); setBusy(false); }
          },
          modal: { ondismiss: () => { post('/api/checkout/cancel', { orderId: r.orderId }).catch(() => {}); setBusy(false); } },
        });
        rzp.on('payment.failed', () => setErr('Payment failed. No money was taken — try again.'));
        rzp.open();
      }
    } catch (e) {
      const er = e as Error & { status?: number };
      if (er.status === 428) setNeedPhone(true);
      setErr(er.message); setBusy(false);
    }
  }

  async function confirmDemo() {
    if (!demo) return;
    setBusy(true); setErr('');
    try { await post('/api/checkout/demo-confirm', { orderId: demo.orderId }); done(demo.orderId); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (types.length === 0) return <p className="small muted">No tickets listed yet.</p>;
  if (upi) return <UpiPay upi={upi} onDone={() => done(upi.orderId)} />;

  if (demo) {
    return (
      <div className="stack g12">
        <div className="alert info">DEMO PAYMENT — no payment gateway is connected yet, so no money is charged. Your ticket will be real and scannable.</div>
        <div className="row between"><span className="soft">{qty} × {t?.name}</span><strong className="mono">{rupees(demo.amount)}</strong></div>
        {err && <div className="alert error">{err}</div>}
        <button className="btn block green" onClick={confirmDemo} disabled={busy}>{busy ? 'Confirming…' : `Pay ${rupees(demo.amount)} (demo)`}</button>
        <button className="btn block outline" onClick={async () => { await post('/api/checkout/cancel', { orderId: demo.orderId }).catch(() => {}); setDemo(null); }} disabled={busy}>Cancel</button>
      </div>
    );
  }

  const gwQuote = t ? quote(t.price, qty, feeCfg, 'gateway') : null;
  const isPaid = (t?.price ?? 0) > 0;
  // Card/UPI checkout switched off (no live payment gateway yet): bank UPI and free tickets still work.
  const cardOff = gateway === 'none';
  const notOnSale = cardOff && isPaid && !upiEnabled;

  return (
    <div className="stack g12">
      <div className="stack g8" role="radiogroup" aria-label="Ticket type">
        {types.map((x) => {
          const out = x.left <= 0;
          return (
            <label key={x.id} className="card tight row g12" style={{ cursor: out ? 'not-allowed' : 'pointer', opacity: out ? 0.5 : 1, borderColor: sel === x.id ? 'var(--yellow)' : undefined, background: 'var(--black)' }}>
              <input type="radio" name="tt" value={x.id} checked={sel === x.id} disabled={out} onChange={() => { setSel(x.id); setQty(1); }} style={{ accentColor: 'var(--yellow)', width: 18, height: 18 }} />
              <span className="grow">
                <span className="row between g8"><strong>{x.name}</strong><span className="display c-yellow" style={{ fontSize: 22 }}>{x.price === 0 ? 'FREE' : rupees(x.price)}</span></span>
                {x.description && <span className="xs muted" style={{ display: 'block' }}>{x.description}</span>}
                <span className={`xs ${x.left < 20 ? 'c-orange' : 'muted'}`} style={{ display: 'block', marginTop: 2 }}>{out ? 'Sold out' : x.left < 20 ? `Only ${x.left} left` : `${x.left} available`}</span>
              </span>
            </label>
          );
        })}
      </div>

      {t && t.left > 0 && q && !notOnSale && (
        <>
          {!single && <div className="row between">
            <span className="label">Quantity</span>
            <div className="row g8">
              <button className="btn sm outline" onClick={() => setQty((v) => Math.max(1, v - 1))} aria-label="Fewer" disabled={qty <= 1}>−</button>
              <span className="mono" style={{ width: 28, textAlign: 'center' }} aria-live="polite">{qty}</span>
              <button className="btn sm outline" onClick={() => setQty((v) => Math.min(maxQty, v + 1))} aria-label="More" disabled={qty >= maxQty}>+</button>
            </div>
          </div>}

          {isPaid && upiEnabled && !cardOff && (
            <div className="stack g8" role="radiogroup" aria-label="Payment method">
              <span className="label">Pay with</span>
              {([['upi_direct', 'UPI to the fest', 'No payment fee · ticket confirmed in a few minutes'], ['gateway', 'Card / UPI checkout', `Instant ticket · +${rupees(gwQuote?.gatewayFee ?? 0)} payment charges`]] as const).map(([m, l, d]) => (
                <label key={m} className="card tight row g12" style={{ cursor: 'pointer', borderColor: method === m ? 'var(--yellow)' : undefined, background: 'var(--black)' }}>
                  <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} style={{ accentColor: 'var(--yellow)', width: 18, height: 18 }} />
                  <span className="grow"><strong>{l}</strong><span className="xs muted" style={{ display: 'block' }}>{d}</span></span>
                </label>
              ))}
            </div>
          )}

          <div className="stack g4 small">
            <div className="row between soft"><span>{registrationId ? 'Entry fee' : 'Tickets'}</span><span className="mono">{rupees(q.subtotal)}</span></div>
            {feeCfg.payer === 'student' && q.fee > 0 && <div className="row between soft"><span>{registrationId ? 'Platform fee' : 'Convenience fee'}</span><span className="mono">{rupees(q.fee)}</span></div>}
            {q.gatewayFee > 0 && <div className="row between soft"><span>Payment charges</span><span className="mono">{rupees(q.gatewayFee)}</span></div>}
            <div className="row between" style={{ fontSize: 16 }}><strong>Total</strong><strong className="mono c-yellow">{rupees(q.total)}</strong></div>
          </div>

          {(needPhone || (method === 'gateway' && gateway === 'cashfree' && !hasPhone && isPaid)) && (
            <label className="field"><span>Mobile number (for the payment page)</span>
              <input className="input" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          )}
        </>
      )}

      {cardOff && isPaid && t && t.left > 0 && (
        <div className="alert info" role="note">
          {upiEnabled
            ? 'Online card/UPI payment opens soon. For now, pay by UPI straight to the fest — no extra fee.'
            : 'Online card/UPI payment opens soon. This ticket can’t be bought online yet.'}
        </div>
      )}

      {err && <div className="alert error" role="alert">{err}</div>}

      {!signedIn ? (
        <Link href={`/login?next=${encodeURIComponent(`/fests/${festSlug}#tickets`)}`} className="btn block">Log in to buy →</Link>
      ) : !isStudent ? (
        <div className="alert info">Tickets are bought from a student account. Log out and sign in as a student to buy.</div>
      ) : (
        <button className="btn block" onClick={buy} disabled={busy || !t || t.left <= 0 || notOnSale}>
          {notOnSale ? 'Not on sale online yet' : busy ? 'Opening payment…' : !q || q.total === 0 ? (addonFor ? 'Add for free →' : 'Get free ticket →') : method === 'upi_direct' ? `Pay ${rupees(q.total)} by UPI →` : `Pay ${rupees(q.total)} →`}
        </button>
      )}
      {signedIn && isStudent && <p className="xs muted" style={{ textAlign: 'center' }}>By continuing you agree to the <Link href="/legal/terms" className="soft">terms</Link> and <Link href="/legal/refunds" className="soft">refund policy</Link>.</p>}
      {gateway === 'demo' && signedIn && isStudent && isPaid && method === 'gateway' && <p className="xs muted" style={{ textAlign: 'center' }}>Card checkout is in demo mode — no money is charged.</p>}
    </div>
  );
}

/* ─── Bank UPI: QR + "open UPI app" + paste UTR ─────────────────────── */
export function UpiPay({ upi, onDone }: { upi: Upi; onDone: () => void }) {
  const [qr, setQr] = useState('');
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(upi.link, { margin: 1, width: 260, color: { dark: '#080808', light: '#F5F0E8' } }).then(setQr).catch(() => {});
    setMobile(/Android|iPhone|iPad/i.test(navigator.userAgent));
  }, [upi.link]);

  async function submit() {
    setBusy(true); setErr('');
    try { await post('/api/checkout/upi-utr', { orderId: upi.orderId, utr }); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="stack g12">
      <div className="alert info">Pay exactly <strong>{rupees(upi.amount)}</strong> — the paise identify your order. Paying a different amount delays your ticket.</div>
      <div className="stack g8" style={{ alignItems: 'center' }}>
        {qr ? <img src={qr} alt="UPI QR code" width={220} height={220} style={{ background: '#F5F0E8' }} /> : <div style={{ width: 220, height: 220, background: 'var(--mid)' }} />}
        <div className="mono small">{upi.vpa}</div>
        <div className="xs muted">Paying {upi.payee} · note {upi.note}</div>
      </div>
      {mobile && <a className="btn block green" href={upi.link}>Open UPI app →</a>}
      <div className="divider" style={{ margin: '4px 0' }} />
      <label className="field"><span>After paying: UPI reference (UTR, 12 digits)</span>
        <input className="input mono" inputMode="numeric" maxLength={14} placeholder="412345678901" value={utr} onChange={(e) => setUtr(e.target.value.replace(/[^\d]/g, ''))} />
      </label>
      <p className="xs muted">Find it in GPay / PhonePe / Paytm → payment history → this payment → “UPI transaction ID” or “UTR”.</p>
      {err && <div className="alert error" role="alert">{err}</div>}
      <button className="btn block" onClick={submit} disabled={busy || utr.length !== 12}>{busy ? 'Checking…' : 'I’ve paid — confirm my ticket'}</button>
    </div>
  );
}

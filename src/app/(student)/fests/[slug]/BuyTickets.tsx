'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rupees } from '@/lib/format';

type T = { id: string; name: string; description: string; price: number; left: number };

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void } }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.body.appendChild(s);
  });
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}

export function BuyTickets({ festSlug, signedIn, isStudent, types, fee, feeOnStudent, demoPayments, prefill }: {
  festSlug: string; signedIn: boolean; isStudent: boolean; types: T[]; fee: number; feeOnStudent: boolean; demoPayments: boolean;
  prefill: { name: string; email: string; contact: string } | null;
}) {
  const router = useRouter();
  const firstAvailable = types.find((t) => t.left > 0)?.id ?? '';
  const [sel, setSel] = useState(firstAvailable);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [demo, setDemo] = useState<{ orderId: string; amount: number } | null>(null);

  const t = types.find((x) => x.id === sel);
  const maxQty = Math.min(10, t?.left ?? 0);
  const subtotal = (t?.price ?? 0) * qty;
  const feeTotal = t && t.price > 0 && feeOnStudent ? fee * qty : 0;
  const total = subtotal + feeTotal;

  const done = (orderId: string) => router.push(`/tickets?order=${orderId}`);

  async function buy() {
    if (!t) return;
    setBusy(true); setErr('');
    try {
      const r = await post('/api/checkout', { ticketTypeId: t.id, qty });
      if (r.mode === 'done') return done(r.orderId);
      if (r.mode === 'demo') { setDemo({ orderId: r.orderId, amount: r.amount }); setBusy(false); return; }
      if (r.mode === 'razorpay') {
        if (!(await loadRazorpay()) || !window.Razorpay) throw new Error('Could not load the payment window. Check your connection.');
        const rzp = new window.Razorpay({
          key: r.keyId, order_id: r.rzpOrderId, amount: r.amount, currency: 'INR',
          name: 'THE FEST', description: `${qty} × ${t.name}`,
          prefill: prefill ?? undefined, theme: { color: '#FFE034' },
          handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            try { await post('/api/checkout/verify', { orderId: r.orderId, ...resp }); done(r.orderId); }
            catch (e) { setErr((e as Error).message); setBusy(false); }
          },
          modal: { ondismiss: () => { post('/api/checkout/cancel', { orderId: r.orderId }).catch(() => {}); setBusy(false); } },
        });
        rzp.on('payment.failed', () => setErr('Payment failed. No money was taken — try again.'));
        rzp.open();
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function confirmDemo() {
    if (!demo) return;
    setBusy(true); setErr('');
    try { await post('/api/checkout/demo-confirm', { orderId: demo.orderId }); done(demo.orderId); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  async function cancelDemo() {
    if (demo) await post('/api/checkout/cancel', { orderId: demo.orderId }).catch(() => {});
    setDemo(null);
  }

  if (types.length === 0) return <p className="small muted">No tickets listed yet.</p>;

  if (demo) {
    return (
      <div className="stack g12">
        <div className="alert info">DEMO PAYMENT — Razorpay isn&apos;t connected yet, so no money is charged. Your ticket will be real and scannable.</div>
        <div className="row between"><span className="soft">{qty} × {t?.name}</span><strong className="mono">{rupees(demo.amount)}</strong></div>
        {err && <div className="alert error">{err}</div>}
        <button className="btn block green" onClick={confirmDemo} disabled={busy}>{busy ? 'Confirming…' : `Pay ${rupees(demo.amount)} (demo)`}</button>
        <button className="btn block outline" onClick={cancelDemo} disabled={busy}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="stack g12">
      <div className="stack g8" role="radiogroup" aria-label="Ticket type">
        {types.map((x) => {
          const out = x.left <= 0;
          return (
            <label key={x.id} className="card tight row g12" style={{ cursor: out ? 'not-allowed' : 'pointer', opacity: out ? 0.5 : 1, borderColor: sel === x.id ? 'var(--yellow)' : undefined, background: 'var(--black)' }}>
              <input type="radio" name="tt" value={x.id} checked={sel === x.id} disabled={out} onChange={() => { setSel(x.id); setQty(1); }} style={{ accentColor: 'var(--yellow)', width: 18, height: 18 }} />
              <span className="grow">
                <span className="row between g8">
                  <strong>{x.name}</strong>
                  <span className="display c-yellow" style={{ fontSize: 22 }}>{x.price === 0 ? 'FREE' : rupees(x.price)}</span>
                </span>
                {x.description && <span className="xs muted" style={{ display: 'block' }}>{x.description}</span>}
                <span className={`xs ${x.left < 20 ? 'c-orange' : 'muted'}`} style={{ display: 'block', marginTop: 2 }}>{out ? 'Sold out' : x.left < 20 ? `Only ${x.left} left` : `${x.left} available`}</span>
              </span>
            </label>
          );
        })}
      </div>

      {t && t.left > 0 && (
        <>
          <div className="row between">
            <span className="label">Quantity</span>
            <div className="row g8">
              <button className="btn sm outline" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer" disabled={qty <= 1}>−</button>
              <span className="mono" style={{ width: 28, textAlign: 'center' }} aria-live="polite">{qty}</span>
              <button className="btn sm outline" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} aria-label="More" disabled={qty >= maxQty}>+</button>
            </div>
          </div>
          <div className="stack g4 small">
            <div className="row between soft"><span>Tickets</span><span className="mono">{rupees(subtotal)}</span></div>
            {feeTotal > 0 && <div className="row between soft"><span>Convenience fee</span><span className="mono">{rupees(feeTotal)}</span></div>}
            <div className="row between" style={{ fontSize: 16 }}><strong>Total</strong><strong className="mono c-yellow">{rupees(total)}</strong></div>
          </div>
        </>
      )}

      {err && <div className="alert error" role="alert">{err}</div>}

      {!signedIn ? (
        <Link href={`/login?next=${encodeURIComponent(`/fests/${festSlug}#tickets`)}`} className="btn block">Log in to buy →</Link>
      ) : !isStudent ? (
        <div className="alert info">Tickets are bought from a student account. Log out and sign in as a student to buy.</div>
      ) : (
        <button className="btn block" onClick={buy} disabled={busy || !t || t.left <= 0}>
          {busy ? 'Opening payment…' : total === 0 ? 'Get free ticket →' : `Pay ${rupees(total)} →`}
        </button>
      )}
      {demoPayments && signedIn && isStudent && <p className="xs muted" style={{ textAlign: 'center' }}>Payments are in demo mode — no money is charged.</p>}
    </div>
  );
}

'use client';
import { startTransition, useActionState } from 'react';
import { rupees } from '@/lib/format';
import type { PaymentsState } from '../../actions';

function Result({ state }: { state: PaymentsState }) {
  if (!state) return null;
  if (state.error) return <div className="alert error" role="alert">{state.error}</div>;
  const r = state.result;
  return (
    <div className="stack g8">
      <div className="alert ok" role="status">{state.message}</div>
      {r && r.flagged.length > 0 && (
        <div className="alert info">Need a look: {r.flagged.map((f) => `${f.utr ?? 'no UTR'} (${rupees(f.amountPaise)}) — ${f.reason}`).join(' · ')}</div>
      )}
      {r && r.unmatched.length > 0 && (
        <p className="xs muted">Not matched yet: {r.unmatched.slice(0, 8).map((u) => `${rupees(u.amountPaise)}${u.utr ? ` (${u.utr})` : ''}`).join(', ')}{r.unmatched.length > 8 ? '…' : ''}. These confirm automatically if a student later enters that UTR.</p>
      )}
    </div>
  );
}

export function PasteAlertsForm({ festId, action }: { festId: string; action: (s: PaymentsState, fd: FormData) => Promise<PaymentsState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => formAction(fd)); }}>
      <input type="hidden" name="festId" value={festId} />
      <label className="field"><span>Paste bank SMS / email alerts</span>
        <textarea className="textarea mono" name="alerts" rows={5} required placeholder={'Dear Customer, Rs.270.37 has been credited to your A/c XX1234 … UPI Ref No 412345678901.\n\n(paste as many as you like)'} style={{ fontSize: 13 }} />
      </label>
      <button className="btn" type="submit" disabled={pending}>{pending ? 'Matching…' : 'Match payments'}</button>
      <Result state={state} />
    </form>
  );
}

export function UploadStatementForm({ festId, action }: { festId: string; action: (s: PaymentsState, fd: FormData) => Promise<PaymentsState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => formAction(fd)); }}>
      <input type="hidden" name="festId" value={festId} />
      <label className="field"><span>Bank statement (CSV or Excel .xlsx)</span>
        <input className="input" type="file" name="statement" accept=".csv,.xlsx,.txt" required />
      </label>
      <button className="btn" type="submit" disabled={pending}>{pending ? 'Reading statement…' : 'Upload & match'}</button>
      <Result state={state} />
    </form>
  );
}

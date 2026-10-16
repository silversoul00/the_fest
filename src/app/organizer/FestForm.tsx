'use client';
import { useState } from 'react';
import { ActionForm, Submit } from '@/components/forms';
import type { ActionState, Fest } from '@/lib/types';

import type { FestFormFields } from '@/lib/fest-form';

const EMOJIS = ['🎉', '🎆', '🎵', '🎨', '🚀', '💡', '⚽', '📈', '🎭', '🎤', '🌿', '🔥'];
const ACCENTS = ['#FFE034', '#FF5C1A', '#00E5A0', '#38BDF8', '#FF2D55', '#B794F6'];

export function FestForm({ action, fest, create }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  /** Only the editable fields — never pass a whole fest row to this client component (it would ship every column to the browser). */
  fest?: FestFormFields;
  create?: boolean;
}) {
  const [emoji, setEmoji] = useState(fest?.emoji ?? '🎉');
  const [accent, setAccent] = useState(fest?.accent ?? '#FFE034');

  return (
    <ActionForm action={action}>
      {fest && <input type="hidden" name="festId" value={fest.id} />}
      <input type="hidden" name="emoji" value={emoji} />
      <input type="hidden" name="accent" value={accent} />

      <label className="field"><span>Fest name</span>
        <input className="input" name="name" required maxLength={60} defaultValue={fest?.name} placeholder="e.g. Neon Utsav 2026" />
      </label>
      <div className="form-row">
        <label className="field"><span>College</span>
          <input className="input" name="college" required defaultValue={fest?.college} placeholder="Your college" />
        </label>
        <label className="field"><span>City</span>
          <input className="input" name="city" required defaultValue={fest?.city ?? 'Bengaluru'} />
        </label>
      </div>
      <div className="form-row">
        <label className="field"><span>Venue (optional)</span>
          <input className="input" name="venue" defaultValue={fest?.venue ?? ''} placeholder="Main grounds" />
        </label>
        <label className="field"><span>Category</span>
          <select className="select" name="category" defaultValue={fest?.category ?? 'cultural'}>
            <option value="cultural">Cultural</option><option value="tech">Tech</option>
            <option value="management">Management</option><option value="sports">Sports</option><option value="other">Other</option>
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field"><span>Starts</span>
          <input className="input" type="date" name="starts_on" required defaultValue={fest?.starts_on} />
        </label>
        <label className="field"><span>Ends</span>
          <input className="input" type="date" name="ends_on" required defaultValue={fest?.ends_on} />
        </label>
      </div>
      <label className="field"><span>Description</span>
        <textarea className="textarea" name="description" maxLength={2000} defaultValue={fest?.description} placeholder="What makes your fest worth going to? Pro shows, competitions, prizes…" />
      </label>
      <label className="field"><span>Total capacity (optional)</span>
        <input className="input" type="number" name="capacity" min={1} inputMode="numeric" defaultValue={fest?.capacity ?? ''} placeholder="Max people across all ticket types" />
      </label>

      <div className="field"><span>Icon & colour</span>
        <div className="row g8 wrap-row">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => setEmoji(e)} className="chip" style={{ fontSize: 20, padding: '6px 10px', borderColor: e === emoji ? 'var(--yellow)' : undefined }} aria-pressed={e === emoji}>{e}</button>
          ))}
        </div>
        <div className="row g8 mt8">
          {ACCENTS.map((c) => (
            <button key={c} type="button" onClick={() => setAccent(c)} aria-label={`Colour ${c}`} aria-pressed={c === accent}
              style={{ width: 34, height: 34, background: c, border: c === accent ? '3px solid var(--white)' : '1px solid var(--border)' }} />
          ))}
        </div>
      </div>

      {create && (
        <div className="card stack g12" style={{ background: 'var(--black)' }}>
          <div className="h3">First ticket type</div>
          <p className="xs muted">You can add more (VIP, workshops, early bird) after creating the fest.</p>
          <label className="field"><span>Ticket name</span>
            <input className="input" name="ticket_name" defaultValue="General Entry" />
          </label>
          <div className="form-row">
            <label className="field"><span>Price (₹) — 0 for free</span>
              <input className="input" name="ticket_price" type="number" min={0} max={10000} step="1" inputMode="numeric" defaultValue={299} />
            </label>
            <label className="field"><span>How many</span>
              <input className="input" name="ticket_quota" type="number" min={1} inputMode="numeric" defaultValue={500} />
            </label>
          </div>
        </div>
      )}

      <Submit pendingText={create ? 'Creating…' : 'Saving…'}>{create ? 'Create fest →' : 'Save changes'}</Submit>
    </ActionForm>
  );
}

'use client';
import { useState } from 'react';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABEL, LIMITS } from '@/lib/event-format';

/** Only what the form shows — never a whole database row. */
export type EventFormValues = {
  title: string; category: string; date: string; start: string; end: string; venue: string; rules: string; prize: string;
  team_min: number; team_max: number; price: number; slots: number; deadline_date: string; deadline_time: string;
  mixed_colleges: boolean; needs_ticket: boolean;
};

/** Fields of the Add / Edit event form. `money` = may set fee, slots and "fest ticket needed" (owner, co-organizer). */
export function EventFields({ v, money, festStart, festEnd, locked, taken }: {
  v: EventFormValues; money: boolean; festStart: string; festEnd: string;
  /** Fee and team size can't change after the first entry. */
  locked?: boolean; taken?: number;
}) {
  const [team, setTeam] = useState(v.team_max > 1);
  const [paid, setPaid] = useState(v.price > 0);
  return (
    <>
      <div className="form-row">
        <label className="field"><span>Event name</span><input className="input" name="title" required maxLength={LIMITS.title} defaultValue={v.title} placeholder="Battle of Bands" /></label>
        <label className="field"><span>Category</span>
          <select className="select" name="category" defaultValue={v.category} style={{ width: '100%' }}>
            {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{EVENT_CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label className="field"><span>Date</span><input className="input" type="date" name="date" required min={festStart} max={festEnd} defaultValue={v.date} /></label>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field"><span>Starts</span><input className="input" type="time" name="start" required defaultValue={v.start} /></label>
          <label className="field"><span>Ends (optional)</span><input className="input" type="time" name="end" defaultValue={v.end} /></label>
        </div>
      </div>
      <label className="field"><span>Venue</span><input className="input" name="venue" maxLength={LIMITS.venue} defaultValue={v.venue} placeholder="Indie Stage" /></label>
      <label className="field"><span>Rules (optional)</span><textarea className="input" name="rules" rows={4} maxLength={LIMITS.rules} defaultValue={v.rules} placeholder="Original songs only. 15 minutes per band." /></label>
      <label className="field"><span>Prize (optional)</span><input className="input" name="prize" maxLength={LIMITS.prize} defaultValue={v.prize} placeholder="₹25,000 + studio session" /></label>

      <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }} disabled={locked}>
        <legend className="label mb8">Who can enter{locked ? ' (fixed after the first entry)' : ''}</legend>
        <div className="row g16 wrap-row">
          <label className="row g8" style={{ minHeight: 44 }}><input type="radio" name="format" value="solo" checked={!team} onChange={() => setTeam(false)} /> Solo</label>
          <label className="row g8" style={{ minHeight: 44 }}><input type="radio" name="format" value="team" checked={team} onChange={() => setTeam(true)} /> Team</label>
        </div>
        {team && (
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="field"><span>Min members</span><input className="input" type="number" name="team_min" min={1} max={LIMITS.maxTeam} defaultValue={Math.max(v.team_min, 1)} /></label>
            <label className="field"><span>Max members</span><input className="input" type="number" name="team_max" min={2} max={LIMITS.maxTeam} defaultValue={Math.max(v.team_max, 2)} /></label>
          </div>
        )}
      </fieldset>
      {/* a disabled fieldset sends nothing: the fixed values go as hidden fields outside it */}
      {locked && <><input type="hidden" name="format" value={team ? 'team' : 'solo'} /><input type="hidden" name="team_min" value={v.team_min} /><input type="hidden" name="team_max" value={v.team_max} /></>}

      {money ? (
        <>
          <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }} disabled={locked}>
            <legend className="label mb8">Entry fee{locked ? ' (fixed after the first entry)' : ''}</legend>
            <div className="row g16 wrap-row">
              <label className="row g8" style={{ minHeight: 44 }}><input type="radio" name="fee" value="free" checked={!paid} onChange={() => setPaid(false)} /> Free</label>
              <label className="row g8" style={{ minHeight: 44 }}><input type="radio" name="fee" value="paid" checked={paid} onChange={() => setPaid(true)} /> Paid</label>
            </div>
            {paid && <label className="field"><span>Fee in ₹ {team ? '(per team — the captain pays once)' : ''} · students also pay a ₹5 platform fee</span>
              <input className="input" type="number" name="price" min={1} max={10000} step="1" defaultValue={v.price || ''} placeholder="200" /></label>}
          </fieldset>
          {locked && <><input type="hidden" name="fee" value={paid ? 'paid' : 'free'} /><input type="hidden" name="price" value={v.price} /></>}
          <label className="field"><span>Slots ({team ? 'teams' : 'people'}){taken ? ` — ${taken} taken, can’t go below that` : ''}</span>
            <input className="input" type="number" name="slots" required min={Math.max(1, taken ?? 0)} max={LIMITS.maxSlots} defaultValue={v.slots || ''} placeholder="50" /></label>
          <label className="row g8" style={{ minHeight: 44 }}><input type="checkbox" name="needs_ticket" defaultChecked={v.needs_ticket} /> Every member needs a fest ticket</label>
        </>
      ) : <p className="xs muted">Fee, slots and “fest ticket needed” are set by the fest’s owner or a co-organizer.</p>}

      <label className="row g8" style={{ minHeight: 44 }}><input type="checkbox" name="mixed_colleges" defaultChecked={v.mixed_colleges} /> Teams may mix students from different colleges</label>
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label className="field"><span>Registration closes (date)</span><input className="input" type="date" name="deadline_date" max={festEnd} defaultValue={v.deadline_date} /></label>
        <label className="field"><span>Time</span><input className="input" type="time" name="deadline_time" defaultValue={v.deadline_time} /></label>
      </div>
      <p className="xs muted">Leave the deadline empty to close registration when the event starts.</p>
    </>
  );
}

'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

function Btn({ children, disabled, className }: { children: React.ReactNode; disabled?: boolean; className: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={disabled || pending}>{pending ? 'Working…' : children}</button>;
}

/** "Share my contact" — the button stays off until the 18+ box is ticked (the server checks it again). */
export function ShareForm({ action, code, brand, hasPhone }: { action: (fd: FormData) => Promise<void>; code: string; brand: string; hasPhone: boolean }) {
  const [adult, setAdult] = useState(false);
  return (
    <form action={action} className="stack g12" style={{ textAlign: 'left' }}>
      <input type="hidden" name="code" value={code} />
      {hasPhone && <label className="check"><input type="checkbox" name="phone" value="yes" /> Also share my phone</label>}
      <label className="field"><span>Course &amp; year (optional)</span>
        <input className="input" name="course_year" maxLength={60} placeholder="e.g. B.Com, 2nd year" autoComplete="off" />
      </label>
      <label className="check"><input type="checkbox" name="adult" value="yes" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> I am 18 or older</label>
      <Btn className="btn blue block" disabled={!adult}>Share my contact with {brand}</Btn>
    </form>
  );
}

/** "Stop sharing" — one tap plus a confirm. */
export function StopSharingForm({ action, sponsorId, from, brand }: { action: (fd: FormData) => Promise<void>; sponsorId: string; from: string; brand: string }) {
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Stop sharing your contact with ${brand}?`)) e.preventDefault(); }}>
      <input type="hidden" name="sponsorId" value={sponsorId} />
      <input type="hidden" name="from" value={from} />
      <Btn className="btn outline block">Stop sharing</Btn>
    </form>
  );
}

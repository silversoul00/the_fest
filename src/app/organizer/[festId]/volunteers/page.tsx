import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getOwnFest, getStaff } from '@/lib/queries';
import { initials, time } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty, Stat } from '@/components/ui';
import { addStaff, removeStaff, resetScannerKeys, toggleStaffCheckin } from '../../actions';

export default async function Volunteers({ params }: { params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const fest = await getOwnFest((await params).festId, user);
  const [staff, scanCounts] = await Promise.all([
    getStaff(fest.id),
    sql<{ email: string; n: number }[]>`
      select u.email::text, count(*)::int n from scans s join users u on u.id = s.scanned_by
      where s.fest_id = ${fest.id} and s.result = 'admitted' group by u.email`,
  ]);
  const scans = new Map(scanCounts.map((r) => [r.email, r.n]));
  const onDuty = staff.filter((s) => s.checked_in_at).length;

  return (
    <div className="stack g16">
      <h1 className="h2">Volunteers</h1>
      <div className="grid-2 grid-3">
        <Stat label="Team" value={staff.length} />
        <Stat label="On duty" value={onDuty} color="var(--green)" />
        <Stat label="Not checked in" value={staff.length - onDuty} color={staff.length - onDuty ? 'var(--orange)' : 'var(--dim)'} />
      </div>

      <div className="card">
        <div className="h3 mb8">Add a volunteer</div>
        <p className="xs muted mb16">They sign up (any role) with this email, then open <span className="mono">/scan</span> to scan tickets for your fest. Duty “Lunch counter” scans lunch only, “Stay desk” (or “Hostel…”) scans stay only — first scan checks in, next scan checks out; “First aid” sees a student’s first-aid card (if they added one) and records nothing; anything else is the gate.</p>
        <ActionForm action={addStaff} resetOnSuccess>
          <input type="hidden" name="festId" value={fest.id} />
          <div className="form-row">
            <label className="field"><span>Name</span><input className="input" name="name" required /></label>
            <label className="field"><span>Email</span><input className="input" type="email" name="email" required /></label>
          </div>
          <div className="form-row">
            <label className="field"><span>Duty</span>
              <input className="input" name="duty" list="duties" defaultValue="Gate 1" />
              <datalist id="duties"><option value="Gate 1" /><option value="Gate 2" /><option value="Gate 3" /><option value="Lunch counter" /><option value="Stay desk" /><option value="First aid" /><option value="Registration desk" /><option value="Main stage" /><option value="Hospitality" /></datalist>
            </label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" name="can_scan" defaultChecked /> Can scan tickets</label>
          </div>
          <Submit className="btn">+ Add to team</Submit>
        </ActionForm>
      </div>

      <details className="card" id="reset-keys">
        <summary className="small" style={{ cursor: 'pointer' }}>Phone lost? Reset scanner keys</summary>
        <p className="xs muted mt8">Scanner phones keep keys so they work without internet. If a phone is lost, reset the keys: everyone scanning for this fest logs in again, and new ticket QRs use the new keys. Also remove that volunteer from the team below.</p>
        <ActionForm action={resetScannerKeys} className="form mt8">
          <input type="hidden" name="festId" value={fest.id} />
          <Submit className="btn sm danger">Reset scanner keys</Submit>
        </ActionForm>
      </details>

      {staff.length === 0 ? <Empty icon="👥" title="No volunteers yet" /> : (
        <div className="list">
          {staff.map((s) => (
            <div key={s.id} className="li wrap-row">
              <div className="avatar" style={{ color: s.checked_in_at ? 'var(--green)' : 'var(--dim)' }}>{initials(s.name)}</div>
              <div className="grow" style={{ minWidth: 160 }}>
                <div>{s.name} {s.can_scan && <span className="badge green" style={{ marginLeft: 4 }}>scanner</span>}</div>
                <div className="xs muted truncate">{s.duty} · {s.email}{scans.get(s.email) ? ` · ${scans.get(s.email)} scans` : ''}</div>
              </div>
              <form action={toggleStaffCheckin}>
                <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={s.id} />
                <button className={`btn sm ${s.checked_in_at ? 'outline' : 'green'}`}>{s.checked_in_at ? `✓ In since ${time(s.checked_in_at)}` : 'Check in'}</button>
              </form>
              <form action={removeStaff}>
                <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={s.id} />
                <button className="btn text xs" style={{ color: 'var(--red)' }} aria-label={`Remove ${s.name}`}>✕</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

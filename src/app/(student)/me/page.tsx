import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { initials, rupees } from '@/lib/format';
import { Stat } from '@/components/ui';
import { ActionForm, Submit } from '@/components/forms';
import { BLOOD_GROUPS } from '@/lib/qr2-format';
import { logout } from '../../(auth)/actions';
import { deleteFirstAid, saveFirstAid } from './actions';
import { LogoutForm } from './LogoutForm';

export const metadata = { title: 'Profile' };

export default async function Me() {
  const user = await requireUser('student');
  const [s] = await sql<{ tickets: number; fests: number; spent: number; staff: number }[]>`
    select
      (select count(*) from tickets where user_id = ${user.id} and status <> 'void')::int as tickets,
      (select count(distinct fest_id) from tickets where user_id = ${user.id} and status = 'used')::int as fests,
      (select coalesce(sum(amount_paise), 0) from orders where user_id = ${user.id} and status = 'paid')::int as spent,
      (select count(*) from fest_staff where email = ${user.email})::int as staff`;
  const [aid] = await sql<{ blood_group: string; allergies: string; emergency_phone: string }[]>`
    select blood_group, allergies, emergency_phone from medical_profiles where user_id = ${user.id}`;

  return (
    <div className="wrap stack g16" style={{ maxWidth: 560 }}>
      <div className="row g16 mt8">
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 28 }}>{initials(user.name)}</div>
        <div className="grow">
          <div className="display" style={{ fontSize: 32 }}>{user.name}</div>
          <div className="small muted">{user.college ?? 'Student'} · {user.email}</div>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <Stat label="Tickets" value={s.tickets} />
        <Stat label="Fests attended" value={s.fests} color="var(--green)" />
        <Stat label="Spent" value={rupees(s.spent, { compact: true })} color="var(--orange)" />
      </div>

      {s.staff > 0 && (
        <a href="/scan/login" className="card link row g12">
          <span style={{ fontSize: 22 }}>📷</span>
          <span className="grow"><strong>You&apos;re a volunteer</strong><br /><span className="small muted">Open the gate scanner</span></span>
          <span className="muted">→</span>
        </a>
      )}

      <div className="card stack g12" id="first-aid">
        <div className="h3">First-aid card (optional)</div>
        {aid
          ? <p className="small" data-first-aid-saved>Saved · blood group {aid.blood_group === 'unknown' ? 'not known' : aid.blood_group}{aid.allergies ? ` · allergies: ${aid.allergies}` : ''} · emergency {aid.emergency_phone}</p>
          : <p className="xs muted">If you get hurt at a fest, the first-aid desk can see this by scanning your ticket — even with no internet.</p>}
        <ActionForm action={saveFirstAid}>
          <div className="form-row">
            <label className="field"><span>Blood group</span>
              <select className="select" name="blood_group" defaultValue={aid?.blood_group ?? ''}>
                <option value="" disabled>Pick one</option>
                {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b === 'unknown' ? 'Don’t know' : b}</option>)}
              </select>
            </label>
            <label className="field"><span>Emergency phone</span>
              <input className="input" name="emergency_phone" inputMode="tel" maxLength={14} defaultValue={aid?.emergency_phone ?? ''} placeholder="10-digit mobile" /></label>
          </div>
          <label className="field"><span>Allergies (short, optional)</span>
            <input className="input" name="allergies" maxLength={16} defaultValue={aid?.allergies ?? ''} placeholder="e.g. Peanuts" /></label>
          <label className="check"><input type="checkbox" name="consent" /> <span className="xs">Share my first-aid card with the first-aid desk at fests I attend. THE FEST hides my blood group, allergies and emergency number inside my ticket QR. Only volunteers on first-aid duty and that fest’s organizers can open it, by scanning my ticket with THE FEST scanner, even without internet. Gate, lunch and stay volunteers can’t see it and it is not on the public ticket page. I can delete it here any time; new QR codes will then leave it out, but a screenshot or print I made earlier can still be opened by that fest’s first-aid desk until the fest ends.</span></label>
          <label className="check"><input type="checkbox" name="adult" /> I am 18 or older</label>
          <Submit className="btn sm">Save first-aid card</Submit>
        </ActionForm>
        {aid && (
          <form action={deleteFirstAid}><button className="btn text xs" style={{ color: 'var(--red)' }} type="submit">Delete my first-aid card</button></form>
        )}
      </div>

      {user.is_admin && <a href="/admin" className="btn outline block">🛡️ THE FEST admin</a>}

      <LogoutForm action={logout} />
      <p className="xs muted" style={{ textAlign: 'center' }}>Need an organizer or sponsor account? Log out and sign up with that role.</p>
    </div>
  );
}

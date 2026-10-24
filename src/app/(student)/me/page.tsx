import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { initials, rupees } from '@/lib/format';
import { Stat } from '@/components/ui';
import { logout } from '../../(auth)/actions';
import { LogoutForm } from './LogoutForm';
import { leadsReady } from '@/lib/sponsor-leads';
import { stopSharing } from '../../booth/[code]/actions';
import { StopSharingForm } from '../../booth/[code]/LeadForms';
import { myRoles } from '@/lib/team';
import { MyFestRoles } from '@/components/MyFestRoles';
import { leaveRole } from '../../organizer/actions';

export const metadata = { title: 'Profile' };

export default async function Me({ searchParams }: { searchParams: Promise<{ stopped?: string; left?: string }> }) {
  const user = await requireUser('student');
  const { stopped, left } = await searchParams;
  const [s] = await sql<{ tickets: number; fests: number; spent: number }[]>`
    select
      (select count(*) from tickets where user_id = ${user.id} and status <> 'void')::int as tickets,
      (select count(distinct fest_id) from tickets where user_id = ${user.id} and status = 'used')::int as fests,
      (select coalesce(sum(amount_paise), 0) from orders where user_id = ${user.id} and status = 'paid')::int as spent`;
  const roles = await myRoles(user);
  // Brands this student chose to share their contact with (active only)
  const shared = (await leadsReady())
    ? await sql<{ sponsor_id: string; brand: string; fest_name: string; shared_at: Date }[]>`
        select l.sponsor_id, s.brand, f.name as fest_name, l.shared_at
        from sponsor_leads l join sponsors s on s.id = l.sponsor_id join fests f on f.id = s.fest_id
        where l.user_id = ${user.id} and l.withdrawn_at is null order by l.shared_at desc`
    : [];

  return (
    <div className="wrap stack g16" style={{ maxWidth: 560 }}>
      <div className="row g16 mt8">
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 28 }}>{initials(user.name)}</div>
        <div className="grow wrap-anywhere">
          <div className="display" style={{ fontSize: 32 }}>{user.name}</div>
          <div className="small muted wrap-anywhere">{user.college ?? 'Student'} · {user.email}</div>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <Stat label="Tickets" value={s.tickets} />
        <Stat label="Fests attended" value={s.fests} color="var(--green)" />
        <Stat label="Spent" value={rupees(s.spent, { compact: true })} color="var(--orange)" />
      </div>

      {left && <div className="alert ok" role="status">You left that role.</div>}
      <MyFestRoles groups={roles} verified={user.verified} from="me" leaveAction={leaveRole} />

      {stopped && <div className="alert ok" role="status">Done — you stopped sharing. The brand is told to delete your details.</div>}
      {shared.length > 0 && (
        <section className="card stack g12" aria-label="Brands you shared your contact with">
          <div className="h3">Brands you shared your contact with</div>
          {shared.map((l) => (
            <div key={l.sponsor_id} className="stack g8" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div><strong style={{ overflowWrap: 'anywhere' }}>{l.brand}</strong><br />
                <span className="xs muted">{l.fest_name} · shared {new Date(l.shared_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              <StopSharingForm action={stopSharing} sponsorId={l.sponsor_id} from="me" brand={l.brand} />
            </div>
          ))}
        </section>
      )}

      {user.is_admin && <a href="/admin" className="btn outline block">🛡️ THE FEST admin</a>}

      <LogoutForm action={logout} />
      <p className="xs muted" style={{ textAlign: 'center' }}>Need an organizer or sponsor account? Log out and sign up with that role.</p>
    </div>
  );
}

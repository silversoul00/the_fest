import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { initials, rupees } from '@/lib/format';
import { Stat } from '@/components/ui';
import { logout } from '../../(auth)/actions';

export const metadata = { title: 'Profile' };

export default async function Me() {
  const user = await requireUser('student');
  const [s] = await sql<{ tickets: number; fests: number; spent: number; staff: number }[]>`
    select
      (select count(*) from tickets where user_id = ${user.id} and status <> 'void')::int as tickets,
      (select count(distinct fest_id) from tickets where user_id = ${user.id} and status = 'used')::int as fests,
      (select coalesce(sum(amount_paise), 0) from orders where user_id = ${user.id} and status = 'paid')::int as spent,
      (select count(*) from fest_staff where email = ${user.email})::int as staff`;

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

      {user.is_admin && <a href="/admin" className="btn outline block">🛡️ THE FEST admin</a>}

      <form action={logout}>
        <button className="btn danger block" type="submit">Log out</button>
      </form>
      <p className="xs muted" style={{ textAlign: 'center' }}>Need an organizer or sponsor account? Log out and sign up with that role.</p>
    </div>
  );
}

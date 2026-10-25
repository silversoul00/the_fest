import Link from 'next/link';
import { dateRange } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/roles';
import { STATUS_TEXT, type MyFestRoles as Group } from '@/lib/team';

const badge = { active: 'green', pending_confirm: 'orange', pending_account: 'orange', not_today: 'gray' } as const;

/** "My fest roles": one card per fest with role badges, status and the right buttons. Only shown fields are passed in. */
export function MyFestRoles({ groups, verified, from, leaveAction }: {
  groups: Group[]; verified: boolean; from: 'me' | 'organizer'; leaveAction: (fd: FormData) => Promise<void>;
}) {
  if (!groups.length) return null;
  return (
    <section className="card stack g12" aria-label="My fest roles" data-my-roles>
      <div className="h3">My fest roles</div>
      {!verified && <p className="small c-orange">Confirm your email to start — your roles stay pending until you do.</p>}
      {groups.map((g) => (
        <div key={g.festId} className="stack g8" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }} data-fest-role={g.festName}>
          <div className="wrap-anywhere"><strong>{g.festName}</strong><br /><span className="xs muted">{dateRange(g.starts_on, g.ends_on)}</span></div>
          <div className="stack g8">
            {g.roles.map((r) => (
              <div key={r.id} className="row wrap-row g8 small">
                <span className="badge blue">{ROLE_LABEL[r.role]}</span>
                {r.scope_label && <span className="xs muted wrap-anywhere">for {r.scope_label}</span>}
                {r.scope_day && <span className="xs muted">on {dateRange(r.scope_day, r.scope_day)}</span>}
                <span className={`badge ${badge[r.status]}`} data-status={r.status}>{STATUS_TEXT[r.status]}</span>
                <details className="grow" style={{ textAlign: 'right' }}>
                  <summary className="xs muted" style={{ cursor: 'pointer' }}>Leave role</summary>
                  <form action={leaveAction} className="mt8">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="from" value={from} />
                    <button className="btn sm danger" type="submit">Yes, leave {ROLE_LABEL[r.role]}</button>
                  </form>
                </details>
              </div>
            ))}
          </div>
          <div className="row wrap-row g8">
            {g.dashboard && <Link href={g.dashboard} className="btn sm">Open dashboard</Link>}
            {g.scanner && <Link href="/scan/login" className="btn sm green">Open scanner</Link>}
          </div>
        </div>
      ))}
    </section>
  );
}

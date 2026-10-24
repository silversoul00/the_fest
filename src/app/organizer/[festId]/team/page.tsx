import Link from 'next/link';
import { sql } from '@/lib/db';
import { pageAccess, rolesReady, ROLES_MISSING } from '@/lib/fest-access';
import { ROLE_HINT, ROLE_KEYS, ROLE_LABEL, VOLUNTEER_ROLES, isRoleKey } from '@/lib/roles';
import { STATUS_TEXT, teamOf, type TeamRow } from '@/lib/team';
import { dateRange, dayLabel, initials, num, time, todayIST } from '@/lib/format';
import { ActionForm, Submit } from '@/components/forms';
import { Empty, Stat } from '@/components/ui';
import { addRole, leaveRole, removeRole, resetScannerKeys, toggleCheckin } from '../../actions';

const PER_PAGE = 50;
const TYPES: Record<string, string> = {
  role: 'Team', fest: 'Fest', ticket: 'Tickets', refund: 'Refunds', upi: 'UPI payments', payments: 'Payment settings',
  sponsor: 'Sponsors', request: 'Brand requests', announce: 'Announcements', schedule: 'Schedule', scanner: 'Scanner keys', scans: 'Scans',
};
const statusBadge = { active: 'green', pending_confirm: 'orange', pending_account: 'orange', not_today: 'gray' } as const;
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const roleText = (r: string) => (r === 'owner' ? 'Owner' : r.split(',').map((x) => (isRoleKey(x) ? ROLE_LABEL[x] : x)).join(', '));

export default async function Team({ params, searchParams }: {
  params: Promise<{ festId: string }>; searchParams: Promise<{ removed?: string; who?: string; type?: string; apage?: string }>;
}) {
  const { user, fest, access } = await pageAccess((await params).festId, 'team');
  const sp = await searchParams;
  const ready = await rolesReady();
  const [team, [owner]] = await Promise.all([
    teamOf(fest.id),
    sql<{ name: string; email: string }[]>`select u.name, u.email::text from fests f join users u on u.id = f.organizer_id where f.id = ${fest.id}`,
  ]);
  const canCoorg = access.perms.has('team_coorg');
  const today = todayIST();

  // One card per person; the owner's own extra roles (e.g. a gate shift) go on the Owner card
  const ownerEmail = owner.email.toLowerCase();
  const people = new Map<string, TeamRow[]>();
  for (const r of team) people.set(r.email, [...(people.get(r.email) ?? []), r]);
  const ownerRows = people.get(ownerEmail) ?? [];
  people.delete(ownerEmail);
  const list = [...people.entries()];
  // Fest days for "Only on this day" (a list, so the field never shows a half-filled date)
  const days: string[] = [];
  for (let d = new Date(`${fest.starts_on}T00:00:00Z`); d <= new Date(`${fest.ends_on}T00:00:00Z`) && days.length < 31; d = new Date(d.getTime() + 864e5)) days.push(d.toISOString().slice(0, 10));
  const active = list.filter(([, rs]) => rs.some((r) => r.status === 'active')).length;
  const pending = list.filter(([, rs]) => rs.every((r) => r.status.startsWith('pending'))).length;
  const onDuty = list.filter(([, rs]) => rs.some((r) => r.checked_in_at && istDay(r.checked_in_at) === today)).length;

  // Activity log (owner and co-organizers)
  const showLog = ready && access.perms.has('activity');
  const type = sp.type && TYPES[sp.type] ? sp.type : '';
  const who = (sp.who ?? '').slice(0, 120);
  const apage = Math.min(1000, Math.max(1, Math.floor(Number(sp.apage) || 1)));
  const logWhere = sql`a.fest_id = ${fest.id} ${who ? sql`and a.actor_email = ${who}` : sql``}
    ${type && type !== 'scans' ? sql`and split_part(a.action, '.', 1) = ${type}` : sql``}`;
  const [actors, rows, [{ total }], scanBy, scanRecent] = showLog ? await Promise.all([
    sql<{ email: string }[]>`select distinct actor_email::text as email from fest_activity where fest_id = ${fest.id} order by 1 limit 200`,
    type === 'scans' ? [] : sql<{ id: number; created_at: Date; actor_email: string; actor_role: string; name: string | null; summary: string }[]>`
      select a.id, a.created_at, a.actor_email::text, a.actor_role, u.name, a.summary
      from fest_activity a left join users u on u.id = a.actor_id
      where ${logWhere} order by a.created_at desc, a.id desc limit ${PER_PAGE} offset ${(apage - 1) * PER_PAGE}`,
    type === 'scans' ? [{ total: 0 }] : sql<{ total: number }[]>`select count(*)::int as total from fest_activity a where ${logWhere}`,
    type === 'scans' ? sql<{ name: string; n: number; dup: number }[]>`
      select coalesce(u.name, 'Unknown') as name, (count(*) filter (where s.result = 'admitted'))::int n, (count(*) filter (where s.result <> 'admitted'))::int dup
      from scans s left join users u on u.id = s.scanned_by where s.fest_id = ${fest.id}
      ${who ? sql`and u.email = ${who}` : sql``} group by u.name order by 2 desc` : [],
    type === 'scans' ? sql<{ id: number; created_at: Date; name: string | null; gate: string | null; result: string }[]>`
      select s.id, s.created_at, u.name, s.gate, s.result from scans s left join users u on u.id = s.scanned_by
      where s.fest_id = ${fest.id} ${who ? sql`and u.email = ${who}` : sql``} order by s.created_at desc limit 100` : [],
  ]) : [[], [], [{ total: 0 }], [], []];
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const logHref = (n: number) => `/organizer/${fest.id}/team?${new URLSearchParams({ ...(who ? { who } : {}), ...(type ? { type } : {}), ...(n > 1 ? { apage: String(n) } : {}) })}#activity`;


  const roleRow = (r: TeamRow, email: string, who: string) => {
    const mine = email === user.email.toLowerCase();
    // Co-organizer and Finance lead roles, and the owner's own roles: only the owner removes them
    const canRemove = canCoorg || (r.role !== 'co_organizer' && r.role !== 'finance' && email !== ownerEmail);
    const pendingPerson = r.status === 'pending_account' || r.status === 'pending_confirm';
    return (
                  <div key={r.id} className="row wrap-row g8 small" data-role-row={r.role}>
                    <span className="badge blue">{ROLE_LABEL[r.role]}</span>
                    {r.scope_label && <span className="xs muted wrap-anywhere">for {r.scope_label}</span>}
                    {r.scope_day && <span className="xs muted">on {dateRange(r.scope_day, r.scope_day)}</span>}
                    {r.duty && <span className="xs muted wrap-anywhere">{r.duty}</span>}
                    {VOLUNTEER_ROLES.includes(r.role) && r.can_scan && <span className="badge green">scanner</span>}
                    <span className={`badge ${statusBadge[r.status]}`} data-status={r.status}>{STATUS_TEXT[r.status]}</span>
                    <span className="grow" />
                    {VOLUNTEER_ROLES.includes(r.role) && (!pendingPerson || r.checked_in_at) && (
                      <form action={toggleCheckin}>
                        <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={r.id} />
                        <button className={`btn sm ${r.checked_in_at ? 'outline' : 'green'}`}>{r.checked_in_at ? `✓ In since ${time(r.checked_in_at)}` : 'Check in'}</button>
                      </form>
                    )}
                    {mine && !canRemove ? (
                      <form action={leaveRole}>
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="from" value="organizer" />
                        <button className="btn sm outline">Leave</button>
                      </form>
                    ) : canRemove && (
                      <form action={removeRole}>
                        <input type="hidden" name="festId" value={fest.id} /><input type="hidden" name="id" value={r.id} />
                        <button className="btn text xs" style={{ color: 'var(--red)' }} aria-label={`Remove ${ROLE_LABEL[r.role]} role of ${who}`}>Remove</button>
                      </form>
                    )}
                  </div>
    );
  };

  return (
    <div className="stack g16">
      <h1 className="h2">Team</h1>
      {!ready && <div className="alert error">{ROLES_MISSING}</div>}
      {sp.removed && <div className="alert ok" role="status">Role removed — their access ends now. They may still hold offline scanner keys until the end of the fest: reset scanner keys below if their phone is not trusted.</div>}

      <div className="grid-2 grid-3">
        <Stat label="Active" value={active} color="var(--green)" />
        <Stat label="Pending" value={pending} color={pending ? 'var(--orange)' : 'var(--dim)'} />
        <Stat label="On duty today" value={onDuty} color="var(--blue)" />
      </div>

      <div className="card" id="add-role">
        <div className="h3 mb8">Add to team</div>
        <p className="xs muted mb16">They sign up (a student account is fine) or log in with this email and confirm it — the role starts then. The same person can be added again with another role or day.</p>
        <ActionForm action={addRole} resetOnSuccess>
          <input type="hidden" name="festId" value={fest.id} />
          <div className="form-row">
            <label className="field"><span>Name</span><input className="input" name="name" placeholder="Optional" /></label>
            <label className="field"><span>Email</span><input className="input" type="email" name="email" required /></label>
          </div>
          <label className="field"><span>Role</span>
            <select className="select" name="role" defaultValue="vol_gate" style={{ width: '100%' }}>
              {ROLE_KEYS.filter((r) => canCoorg || (r !== 'co_organizer' && r !== 'finance')).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_HINT[r]}</option>)}
            </select>
          </label>
          <div className="form-row">
            <label className="field"><span>Only for (optional)</span><input className="input" name="scope_label" placeholder="e.g. Battle of Bands" maxLength={60} /></label>
            <label className="field"><span>Only on this day (optional)</span>
              <select className="select" name="scope_day" defaultValue="" style={{ width: '100%' }}>
                <option value="">Every fest day</option>
                {days.map((d) => <option key={d} value={d}>{dateRange(d, d)}</option>)}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="field"><span>Desk name (volunteers)</span>
              <input className="input" name="duty" list="duties" placeholder="Gate 1" />
              <datalist id="duties"><option value="Gate 1" /><option value="Gate 2" /><option value="Gate 3" /><option value="Lunch counter" /><option value="Stay desk" /><option value="Registration desk" /></datalist>
            </label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" name="can_scan" defaultChecked /> Can scan tickets (volunteers)</label>
          </div>
          <Submit className="btn">+ Add to team</Submit>
        </ActionForm>
      </div>

      <details className="card" id="reset-keys">
        <summary className="small" style={{ cursor: 'pointer' }}>Phone lost? Reset scanner keys</summary>
        <p className="xs muted mt8">Scanner phones keep keys so they work without internet. If a phone is lost, reset the keys: everyone scanning for this fest logs in again, and new ticket QRs use the new keys. Also remove that person’s role below.</p>
        <ActionForm action={resetScannerKeys} className="form mt8">
          <input type="hidden" name="festId" value={fest.id} />
          <Submit className="btn sm danger">Reset scanner keys</Submit>
        </ActionForm>
      </details>

      <div className="list" id="team-list">
        <div className="li wrap-row" data-person={owner.email}>
          <div className="avatar">{initials(owner.name)}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="wrap-anywhere">{owner.name} <span className="badge yellow" style={{ marginLeft: 4 }}>Owner</span></div>
            <div className="xs muted wrap-anywhere">{owner.email}</div>
            {ownerRows.length > 0 && <div className="stack g8 mt8">{ownerRows.map((r) => roleRow(r, ownerEmail, owner.name))}</div>}
          </div>
        </div>
        {list.length === 0 && <Empty icon="👥" title="Just the owner so far" />}
        {list.map(([email, rs]) => (
          <div key={email} className="li wrap-row member" data-person={email} style={{ alignItems: 'flex-start' }}>
            <div className="avatar" style={{ color: rs.some((r) => r.status === 'active') ? 'var(--green)' : 'var(--dim)' }}>{initials(rs[0].name || email)}</div>
            <div className="grow stack g8" style={{ minWidth: 0 }}>
              <div className="wrap-anywhere">{rs[0].name || <span className="muted">No name yet</span>}
                <div className="xs muted wrap-anywhere">{email}{rs[0].scans ? ` · ${num(rs[0].scans)} scans` : ''}</div></div>
              {rs.map((r) => roleRow(r, email, rs[0].name || email))}
            </div>
          </div>
        ))}
      </div>

      {showLog && (
        <section className="card stack g12" id="activity" aria-label="Activity">
          <div className="h3">Activity</div>
          <p className="xs muted">Who did what, newest first (India time). The log can’t be edited or deleted; entries are kept for a year.</p>
          <form className="row wrap-row g8" method="get" action={`/organizer/${fest.id}/team#activity`}>
            <select className="select grow" name="who" defaultValue={who} aria-label="Person" style={{ minWidth: 0 }}>
              <option value="">Everyone</option>
              {actors.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
            </select>
            <select className="select grow" name="type" defaultValue={type} aria-label="Type" style={{ minWidth: 0 }}>
              <option value="">All types</option>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="btn sm" type="submit">Filter</button>
          </form>
          {type === 'scans' ? (
            <>
              <div className="stack g8">
                {scanBy.length === 0 ? <p className="small muted">No scans yet.</p> : scanBy.map((s) => (
                  <div key={s.name} className="row between small"><span className="truncate">{s.name}</span><span className="mono">{num(s.n)} in · {num(s.dup)} refused</span></div>
                ))}
              </div>
              <div className="stack" data-scan-log>
                {scanRecent.map((s) => (
                  <div key={s.id} className="row wrap-row g8 xs" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="mono muted">{dayLabel(s.created_at)}, {time(s.created_at)}</span>
                    <span className="grow truncate">{s.name ?? 'Unknown'} · {s.gate ?? '—'}</span>
                    <span className={`badge ${s.result === 'admitted' ? 'green' : 'orange'}`}>{s.result}</span>
                  </div>
                ))}
              </div>
            </>
          ) : rows.length === 0 ? <p className="small muted">Nothing yet.</p> : (
            <div className="stack" data-activity>
              {rows.map((a) => (
                <div key={a.id} className="stack" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 2 }} data-activity-row>
                  <span className="small wrap-anywhere">{a.summary}</span>
                  <span className="xs muted wrap-anywhere">{a.name ?? a.actor_email} ({roleText(a.actor_role)}) · {dayLabel(a.created_at)}, {time(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          {type !== 'scans' && total > PER_PAGE && (
            <nav className="row between g8 small" aria-label="Activity pages">
              {apage > 1 ? <Link className="btn sm outline" href={logHref(apage - 1)}>← Newer</Link> : <span />}
              <span className="muted">page {Math.min(apage, pages)} of {pages}</span>
              {apage < pages ? <Link className="btn sm outline" href={logHref(apage + 1)}>Older →</Link> : <span />}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

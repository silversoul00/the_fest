import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { actorOf, eventAllowed, eventsReady, festAccess, logActivity } from '@/lib/fest-access';
import { csvResponse, toCsv } from '@/lib/csv';
import { slugify } from '@/lib/format';

// CSV of one event's entries: one row per member. Only the `events` perm (owner, co-organizer) or that event's head.
export async function GET(_req: Request, { params }: { params: Promise<{ festId: string; eventId: string }> }) {
  const user = await getUser();
  const { festId, eventId } = await params;
  if (!user || !isUuid(festId) || !isUuid(eventId) || !(await eventsReady())) return new Response('Not found', { status: 404 });
  const access = await festAccess(festId, user);
  if (!access) return new Response('Not found', { status: 404 });
  const [ev] = await sql<{ title: string }[]>`select title from events where id = ${eventId} and fest_id = ${access.fest.id}`;
  if (!ev || !eventAllowed(access, eventId, 'manage')) return new Response('Not found', { status: 404 });

  const rows = await sql<Record<string, unknown>[]>`
    select coalesce(r.team_name, '') as team, r.status as entry_status, (m.user_id = r.captain_id) as captain,
           coalesce(u.name, '') as name, m.email::text as email, coalesce(u.college, '') as college, m.status as member_status,
           coalesce((select ((o.amount_paise - o.refunded_paise) / 100.0)::numeric(10,2)::text from orders o
                     where o.registration_id = r.id and o.status in ('paid', 'refunded') order by o.created_at desc limit 1), '') as paid_inr,
           case when m.checked_in_at is not null then 'yes' else '' end as present,
           coalesce(to_char(m.checked_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), '') as present_at_ist
    from event_members m join event_regs r on r.id = m.reg_id left join users u on u.id = m.user_id
    where m.event_id = ${eventId} and m.status in ('joined', 'invited')
    order by r.created_at, m.invited_at`;
  await logActivity(actorOf({ user, access }), 'event.export', `Downloaded the entry list of “${ev.title}”`, { event: eventId, rows: rows.length });
  const cols = ['team', 'entry_status', 'captain', 'name', 'email', 'college', 'member_status', 'paid_inr', 'present', 'present_at_ist'];
  return csvResponse(toCsv(cols, rows), `${slugify(access.fest.slug + '-' + ev.title) || 'event'}-entries.csv`);
}

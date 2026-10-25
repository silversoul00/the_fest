import { sql } from '@/lib/db';
import { eventsReady, myFestIds, pageAccess } from '@/lib/fest-access';
import { allowedTabs } from '@/lib/roles';
import { OrgShell } from '@/components/OrgShell';
import { VerifyNotice } from '@/components/VerifyNotice';
import { logout } from '../../(auth)/actions';
import { requestsReady } from '@/lib/sponsor-requests';
import { scannerAt } from '@/lib/queries';

export default async function FestLayout({ children, params }: { children: React.ReactNode; params: Promise<{ festId: string }> }) {
  // Any active role (or the owner) gets the shell; each page checks its own tab's permission too.
  const { user, fest, access } = await pageAccess((await params).festId, null);
  const [ids, scanner, evReady] = await Promise.all([myFestIds(user), scannerAt(user, fest.id), eventsReady()]);
  const fests = ids.length ? await sql<{ id: string; name: string }[]>`select id, name from fests where id in ${sql(ids)} order by starts_on desc` : [];
  // Open sponsorship requests from brands, counted on page load (no realtime)
  const [w] = access.perms.has('sponsors') && (await requestsReady()) ? await sql<{ n: number }[]>`
    select count(*)::int n from sponsor_requests r join fests f on f.id = r.fest_id
    where r.fest_id = ${fest.id} and r.direction = 'brand_to_org' and r.status = 'sent'
      and f.status not in ('cancelled', 'ended') and f.ends_on >= (now() at time zone 'Asia/Kolkata')::date` : [];

  return (
    <OrgShell festId={fest.id} festName={fest.name} slug={fest.slug} status={fest.status} fests={[...fests]} userName={user.name}
      youAre={access.label} tabs={allowedTabs(access.perms).filter((t) => t !== '/events' || evReady)} canCreate={user.role === 'organizer'}
      isAdmin={!!user.is_admin} scanner={scanner} logoutAction={logout} badges={{ '/sponsors': w?.n ?? 0 }}>
      {!user.verified && <VerifyNotice email={user.email} />}
      {children}
    </OrgShell>
  );
}

import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canManage, getOwnFest } from '@/lib/queries';
import { OrgShell } from '@/components/OrgShell';
import { VerifyNotice } from '@/components/VerifyNotice';
import { logout } from '../../(auth)/actions';
import { requestsReady } from '@/lib/sponsor-requests';

export default async function FestLayout({ children, params }: { children: React.ReactNode; params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const { festId } = await params;
  const fest = await getOwnFest(festId, user);
  const fests = await sql<{ id: string; name: string }[]>`select f.id, f.name from fests f where ${canManage(user)} order by f.starts_on desc`;
  // Open sponsorship requests from brands, counted on page load (no realtime)
  const [w] = (await requestsReady()) ? await sql<{ n: number }[]>`
    select count(*)::int n from sponsor_requests r join fests f on f.id = r.fest_id
    where r.fest_id = ${fest.id} and r.direction = 'brand_to_org' and r.status = 'sent'
      and f.status not in ('cancelled', 'ended') and f.ends_on >= (now() at time zone 'Asia/Kolkata')::date` : [];

  return (
    <OrgShell festId={fest.id} festName={fest.name} slug={fest.slug} status={fest.status} fests={[...fests]} userName={user.name} isAdmin={!!user.is_admin} logoutAction={logout} badges={{ '/sponsors': w?.n ?? 0 }}>
      {!user.verified && <VerifyNotice email={user.email} />}
      {children}
    </OrgShell>
  );
}

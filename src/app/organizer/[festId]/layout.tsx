import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { canManage, getOwnFest } from '@/lib/queries';
import { OrgShell } from '@/components/OrgShell';
import { VerifyNotice } from '@/components/VerifyNotice';
import { logout } from '../../(auth)/actions';

export default async function FestLayout({ children, params }: { children: React.ReactNode; params: Promise<{ festId: string }> }) {
  const user = await requireUser('organizer');
  const { festId } = await params;
  const fest = await getOwnFest(festId, user);
  const fests = await sql<{ id: string; name: string }[]>`select f.id, f.name from fests f where ${canManage(user)} order by f.starts_on desc`;

  return (
    <OrgShell festId={fest.id} festName={fest.name} slug={fest.slug} status={fest.status} fests={[...fests]} userName={user.name} isAdmin={!!user.is_admin} logoutAction={logout}>
      {!user.verified && <VerifyNotice email={user.email} />}
      {children}
    </OrgShell>
  );
}

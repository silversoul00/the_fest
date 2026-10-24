import Link from 'next/link';
import { pageAccess } from '@/lib/fest-access';
import { firstTab } from '@/lib/roles';
import { scannerAt } from '@/lib/queries';

export const metadata = { title: 'Not for your role' };

/** Shown when someone on the team opens a tab their role doesn't cover (pageAccess sends them here). */
export default async function NoAccess({ params }: { params: Promise<{ festId: string }> }) {
  const { user, fest, access } = await pageAccess((await params).festId, null);
  const home = firstTab(fest.id, access.perms);
  const scanner = await scannerAt(user, fest.id);
  return (
    <div className="stack g16" style={{ maxWidth: 520 }} data-no-access>
      <h1 className="h2">Your role can’t open this tab</h1>
      <p className="soft">You’re on the team of {fest.name} as {access.label}. Ask the fest’s owner or a co-organizer if you need more access.</p>
      <div className="row wrap-row g8">
        {home && <Link href={home} className="btn sm">Go to your tab</Link>}
        {scanner && <Link href="/scan/login" className="btn sm outline" data-scanner-link>Open {scanner.toLowerCase()}</Link>}
        <Link href="/me" className="btn sm outline">My fest roles</Link>
      </div>
    </div>
  );
}

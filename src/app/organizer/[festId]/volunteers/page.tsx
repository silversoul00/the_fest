import { redirect } from 'next/navigation';
import { pageAccess } from '@/lib/fest-access';

/** The Volunteers tab became Team (v2.7). Old links land there — with the same permission check. */
export default async function Volunteers({ params }: { params: Promise<{ festId: string }> }) {
  const { fest } = await pageAccess((await params).festId, 'team');
  redirect(`/organizer/${fest.id}/team`);
}

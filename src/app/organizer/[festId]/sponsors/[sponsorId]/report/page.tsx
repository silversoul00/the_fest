import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageAccess } from '@/lib/fest-access';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { loadSponsorReport } from '@/lib/sponsor-report';
import { SponsorReportView } from '@/components/SponsorReportView';

export const metadata = { title: 'Sponsor report' };

// The organizer's copy of a sponsor's report, to print or save as PDF and send. Counts only — never lead contacts.
export default async function OrgSponsorReport({ params }: { params: Promise<{ festId: string; sponsorId: string }> }) {
  const { festId, sponsorId } = await params;
  const { fest } = await pageAccess(festId, 'sponsors');
  if (!isUuid(sponsorId)) notFound();
  const [own] = await sql`select 1 from sponsors where id = ${sponsorId} and fest_id = ${fest.id}`;
  if (!own) notFound();
  const r = await loadSponsorReport(sponsorId);
  if (!r) notFound();
  return (
    <div className="stack g16" style={{ maxWidth: 900 }}>
      <Link href={`/organizer/${fest.id}/sponsors`} className="label no-print">← Sponsors</Link>
      <SponsorReportView r={r} generatedAt={new Date()} />
    </div>
  );
}

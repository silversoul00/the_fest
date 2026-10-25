import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { loadSponsorReport } from '@/lib/sponsor-report';
import { SponsorReportView } from '@/components/SponsorReportView';

export const metadata = { title: 'Sponsor report' };

// The sponsor's own ROI report (owner only: same email check as the dashboard).
export default async function SponsorReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('sponsor');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [own] = await sql`select 1 from sponsors s join fests f on f.id = s.fest_id
                          where s.id = ${id} and s.email = ${user.email} and ${user.verified} and f.status <> 'draft'`;
  if (!own) notFound();
  const r = await loadSponsorReport(id);
  if (!r) notFound();
  return (
    <main className="wrap page stack g16" style={{ ['--accent' as string]: 'var(--blue)', maxWidth: 900 }}>
      <Link href={`/sponsor/${id}`} className="label no-print">← Back to dashboard</Link>
      <SponsorReportView r={r} generatedAt={new Date()} />
    </main>
  );
}

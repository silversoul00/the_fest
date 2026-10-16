import { redirect } from 'next/navigation';
import { getScanner } from '@/lib/auth';
import { sql } from '@/lib/db';
import { scannableFests } from '@/lib/queries';
import { Scanner } from './Scanner';
import { lockScanner } from './actions';

export const metadata = { title: 'Gate scanner' };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ fest?: string }> }) {
  const scanner = await getScanner();
  if (!scanner) redirect('/scan/login');
  const fests = await scannableFests(scanner);
  if (!fests.length) redirect('/scan/login');

  const { fest: wanted } = await searchParams;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  // Default: the fest happening today, else the next one
  const current = fests.find((f) => f.id === wanted) ?? fests.find((f) => f.starts_on <= today && today <= f.ends_on) ?? fests[0];

  const [counts] = await sql<{ inn: number; total: number; mine: number }[]>`
    select (select count(*) from tickets where fest_id = ${current.id} and status = 'used')::int inn,
           (select count(*) from tickets where fest_id = ${current.id} and status <> 'void')::int total,
           (select count(*) from scans where fest_id = ${current.id} and scanned_by = ${scanner.id} and result = 'admitted')::int mine`;

  return (
    <Scanner
      fests={fests.map((f) => ({ id: f.id, name: f.name, duty: f.duty }))}
      festId={current.id}
      festName={current.name}
      defaultGate={current.duty?.startsWith('Gate') ? current.duty : 'Gate 1'}
      volunteer={scanner.name}
      initialCounts={counts}
      lockAction={lockScanner}
    />
  );
}

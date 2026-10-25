import { redirect } from 'next/navigation';
import { getScanner } from '@/lib/auth';
import { sql } from '@/lib/db';
import { scannableFests } from '@/lib/queries';
import { rolesReady } from '@/lib/fest-access';
import { perkCounts, type Counter } from '@/lib/scan';
import { counterEvents, eventCounts } from '@/lib/events';
import { Scanner } from './Scanner';
import { lockScanner } from './actions';

export const metadata = { title: 'Gate scanner' };

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ fest?: string; counter?: string; event?: string }> }) {
  const scanner = await getScanner();
  if (!scanner) redirect('/scan/login');
  // Only fests this person can scan at today (a day-limited role on another day is told so at login)
  const fests = (await scannableFests(scanner)).filter((f) => f.counters.length);
  if (!fests.length) redirect('/scan/login');

  const { fest: wanted, counter: picked, event: pickedEvent } = await searchParams;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  // Default: the fest happening today, else the next one
  const current = fests.find((f) => f.id === wanted) ?? fests.find((f) => f.starts_on <= today && today <= f.ends_on) ?? fests[0];

  // Volunteers get the counter(s) their role(s) give (Gate / Lunch / Stay); owners and co-organizers pick any.
  const counter: Counter = current.counters.includes(picked as Counter) ? (picked as Counter) : current.counters[0];
  const staffDuty = await scanDuty(current.id, scanner.email);

  // Event counter: the events this person may mark (event heads: theirs; managers: all)
  const events = counter === 'event' ? await counterEvents(current.id, scanner, current.manager) : [];
  const event = events.find((e) => e.id === pickedEvent) ?? events[0] ?? null;

  const [counts] = counter === 'event' ? [event ? await eventCounts(event.id, scanner.id) : { inn: 0, total: 0, mine: 0 }]
    : counter !== 'gate' ? [await perkCounts(current.id, scanner.id, counter)] : await sql<{ inn: number; total: number; mine: number }[]>`
    select (select count(*) from tickets where fest_id = ${current.id} and status = 'used')::int inn,
           (select count(*) from tickets where fest_id = ${current.id} and status <> 'void')::int total,
           (select count(*) from scans where fest_id = ${current.id} and scanned_by = ${scanner.id} and result = 'admitted')::int mine`;

  return (
    <Scanner
      key={`${current.id}:${counter}:${event?.id ?? ''}`}
      events={events}
      eventId={event?.id ?? null}
      counter={counter}
      counters={current.counters}
      fests={fests.map((f) => ({ id: f.id, name: f.name }))}
      festId={current.id}
      festName={current.name}
      defaultGate={staffDuty && /^gate/i.test(staffDuty) ? staffDuty : 'Gate 1'}
      volunteer={scanner.name}
      scannerId={scanner.id}
      initialCounts={counts}
      lockAction={lockScanner}
    />
  );
}

/** The volunteer's desk name ("Gate 2"), to preselect their gate. */
async function scanDuty(festId: string, email: string) {
  if (!(await rolesReady())) return null;
  const [r] = await sql<{ duty: string | null }[]>`
    select duty from fest_roles where fest_id = ${festId} and email = ${email} and role in ('vol_gate', 'desk') and duty is not null limit 1`;
  return r?.duty ?? null;
}

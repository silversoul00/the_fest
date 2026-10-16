import Link from 'next/link';
import type { CSSProperties } from 'react';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { dateRange, todayIST } from '@/lib/format';
import { Empty } from '@/components/ui';

export const metadata = { title: 'My tickets' };

type Row = {
  id: string; code: string; holder_name: string; status: string; checked_in_at: Date | null;
  type_name: string; fest_name: string; slug: string; emoji: string; accent: string; college: string;
  starts_on: string; ends_on: string; order_id: string;
};

export default async function MyTickets({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const user = await requireUser('student');
  const { order } = await searchParams;
  const rows = await sql<Row[]>`
    select t.id, t.code, t.holder_name, t.status, t.checked_in_at, t.order_id,
           tt.name as type_name, f.name as fest_name, f.slug, f.emoji, f.accent, f.college, f.starts_on, f.ends_on
    from tickets t
    join ticket_types tt on tt.id = t.ticket_type_id
    join fests f on f.id = t.fest_id
    where t.user_id = ${user.id} and t.status <> 'void'
    order by f.starts_on asc, t.issued_at asc`;

  const today = todayIST();
  const upcoming = rows.filter((r) => r.ends_on >= today);
  const past = rows.filter((r) => r.ends_on < today);
  const fresh = order ? rows.filter((r) => r.order_id === order) : [];

  return (
    <div className="wrap stack g16">
      <h1 className="h2 mt8">My tickets</h1>

      {fresh.length > 0 && (
        <div className="alert ok">🎉 You&apos;re in! {fresh.length} ticket{fresh.length > 1 ? 's' : ''} for {fresh[0].fest_name}. Show the QR at the gate.</div>
      )}

      {rows.length === 0 ? (
        <Empty icon="🎟️" title="No tickets yet">
          <Link className="accent" href="/fests">Find a fest →</Link>
        </Empty>
      ) : (
        <>
          <TicketList rows={upcoming} />
          {past.length > 0 && (
            <>
              <div className="label mt16">Past fests</div>
              <TicketList rows={past} dim />
            </>
          )}
        </>
      )}
    </div>
  );
}

function TicketList({ rows, dim }: { rows: Row[]; dim?: boolean }) {
  return (
    <div className="grid-auto">
      {rows.map((r) => (
        <Link key={r.id} href={`/tickets/${r.id}`} className="card link row g16" style={{ '--accent': r.accent, opacity: dim ? 0.6 : 1 } as CSSProperties}>
          <div className="fest-banner" style={{ width: 64, height: 64, flexShrink: 0, '--fest': r.accent } as CSSProperties}>
            <span className="emoji" style={{ fontSize: 30 }}>{r.emoji}</span>
          </div>
          <div className="grow">
            <div className="display truncate" style={{ fontSize: 24 }}>{r.fest_name}</div>
            <div className="xs muted truncate">{r.type_name} · {dateRange(r.starts_on, r.ends_on)}</div>
            <div className="row g8 mt8">
              {r.status === 'used'
                ? <span className="badge gray">✓ Checked in</span>
                : <span className="badge green">Valid</span>}
              <span className="mono xs muted">{r.code}</span>
            </div>
          </div>
          <span className="muted">→</span>
        </Link>
      ))}
    </div>
  );
}

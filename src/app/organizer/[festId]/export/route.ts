import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';

// CSV of every issued ticket — for the registration desk, certificates, or Excel.
export async function GET(_req: Request, { params }: { params: Promise<{ festId: string }> }) {
  const user = await getUser();
  const { festId } = await params;
  if (!user || user.role !== 'organizer' || !isUuid(festId)) return new Response('Not found', { status: 404 });
  const [fest] = await sql<{ slug: string }[]>`select slug from fests where id = ${festId} and organizer_id = ${user.id}`;
  if (!fest) return new Response('Not found', { status: 404 });

  const rows = await sql<Record<string, unknown>[]>`
    select t.code, t.holder_name, u.email::text as email, u.phone, u.college, tt.name as ticket_type,
           (o.amount_paise / o.qty / 100.0)::numeric(10,2) as paid_per_ticket_inr, o.provider as payment,
           to_char(o.paid_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as bought_ist,
           t.status, to_char(t.checked_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as checked_in_ist, t.gate
    from tickets t join orders o on o.id = t.order_id join users u on u.id = t.user_id join ticket_types tt on tt.id = t.ticket_type_id
    where t.fest_id = ${festId} order by o.paid_at`;

  const cols = ['code', 'holder_name', 'email', 'phone', 'college', 'ticket_type', 'paid_per_ticket_inr', 'payment', 'bought_ist', 'status', 'checked_in_ist', 'gate'];
  // Quote every cell; neutralise spreadsheet formula injection (=, +, -, @)
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fest.slug}-tickets.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

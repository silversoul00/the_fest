import { getUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { csvResponse, toCsv } from '@/lib/csv';
import { LEADS_MISSING, leadsReady } from '@/lib/sponsor-leads';

// Leads CSV for the sponsor who owns this sponsorship. Active leads first, then everyone who stopped sharing
// (status "withdrawn", email only) so the brand can delete them from its own lists.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  const { id } = await params;
  if (!user || user.role !== 'sponsor' || !user.verified || !isUuid(id)) return new Response('Not found', { status: 404 });
  const [s] = await sql<{ brand: string }[]>`
    select s.brand from sponsors s join fests f on f.id = s.fest_id where s.id = ${id} and s.email = ${user.email} and f.status <> 'draft'`;
  if (!s) return new Response('Not found', { status: 404 });
  if (!(await leadsReady())) return new Response(LEADS_MISSING, { status: 503 });

  const rows = await sql<Record<string, unknown>[]>`
    select case when withdrawn_at is null then 'active' else 'withdrawn' end as status,
           name, email::text as email, phone, college, course_year,
           to_char(shared_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as shared_at_ist,
           to_char(withdrawn_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as withdrawn_at_ist
    from sponsor_leads where sponsor_id = ${id}
    order by (withdrawn_at is not null), shared_at desc`;
  const cols = ['status', 'name', 'email', 'phone', 'college', 'course_year', 'shared_at_ist', 'withdrawn_at_ist'];
  const slug = s.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sponsor';
  return csvResponse(toCsv(cols, rows), `${slug}-leads.csv`);
}

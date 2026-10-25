import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ago } from '@/lib/format';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Errors' };

export default async function AdminErrors() {
  // Every admin page checks for itself: layouts don't run on client-side navigation requests.
  await requireAdmin();
  let rows: { id: number; at: Date; where_: string | null; message: string | null; path: string | null; repeats: number }[];
  let day: number;
  try {
    rows = await sql<typeof rows>`
      select id, at, where_, message, path, repeats from app_errors order by at desc, id desc limit 100`;
    [{ last_day: day }] = await sql<{ last_day: number }[]>`select coalesce(sum(repeats), 0)::int last_day from app_errors where at > now() - interval '24 hours'`;
  } catch (e) {
    // Table (or its newer columns) not created yet in this database
    if (!['42P01', '42703'].includes((e as { code?: string }).code ?? '')) throw e;
    return (
      <>
        <h1 className="h2">Errors</h1>
        <div className="alert error" role="alert">Database setup incomplete — run Part 2a of the launch checklist (docs/LAUNCH-CHECKLIST.md) in Supabase → SQL Editor. Until then errors can’t be listed here.</div>
      </>
    );
  }

  return (
    <>
      <h1 className="h2">Errors</h1>
      <p className="small soft">Things that went wrong on the server, newest first (last 100). {day} in the past 24 hours. The same error again within a few minutes is counted on one line. You get an email at most once every 15 minutes when new ones appear. Errors older than 30 days are cleared automatically.</p>
      {rows.length === 0 ? <Empty icon="✅" title="No errors" /> : (
        <div className="list">
          {rows.map((e) => {
            const firstLine = (e.message ?? '').split('\n')[0];
            return (
              <div key={e.id} className="li" style={{ display: 'block', minWidth: 0 }}>
                <div className="row between g8 wrap-row">
                  <strong className="small" style={{ wordBreak: 'break-word' }}>{e.where_ ?? 'unknown'}</strong>
                  <span className="xs muted" title={new Date(e.at).toISOString()}>{e.repeats > 1 ? `${e.repeats} times, last ` : ''}{ago(e.at)}</span>
                </div>
                {e.path && <div className="xs muted mono" style={{ wordBreak: 'break-all' }}>{e.path}</div>}
                <div className="small c-orange" style={{ wordBreak: 'break-word', marginTop: 4 }}>{firstLine}</div>
                {(e.message ?? '').includes('\n') && (
                  <details className="mt8">
                    <summary className="xs muted">Details</summary>
                    <pre className="xs mono soft" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '6px 0 0' }}>{e.message}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

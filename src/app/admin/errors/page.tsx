import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ago } from '@/lib/format';
import { Empty } from '@/components/ui';

export const metadata = { title: 'Errors' };

export default async function AdminErrors() {
  // Every admin page checks for itself: layouts don't run on client-side navigation requests.
  await requireAdmin();
  const rows = await sql<{ id: number; at: Date; where_: string | null; message: string | null; path: string | null }[]>`
    select id, at, where_, message, path from app_errors order by at desc, id desc limit 100`;
  const [{ last_day: day }] = await sql<{ last_day: number }[]>`select count(*)::int last_day from app_errors where at > now() - interval '24 hours'`;

  return (
    <>
      <h1 className="h2">Errors</h1>
      <p className="small soft">Things that went wrong on the server, newest first (last 100). {day} in the past 24 hours. You get an email at most once every 15 minutes when new ones appear.</p>
      {rows.length === 0 ? <Empty icon="✅" title="No errors" /> : (
        <div className="list">
          {rows.map((e) => {
            const firstLine = (e.message ?? '').split('\n')[0];
            return (
              <div key={e.id} className="li" style={{ display: 'block', minWidth: 0 }}>
                <div className="row between g8 wrap-row">
                  <strong className="small" style={{ wordBreak: 'break-word' }}>{e.where_ ?? 'unknown'}</strong>
                  <span className="xs muted" title={new Date(e.at).toISOString()}>{ago(e.at)}</span>
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

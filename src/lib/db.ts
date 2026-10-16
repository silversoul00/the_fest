import 'server-only';
import postgres from 'postgres';

// One pool per server instance. In dev, Next.js hot-reloads modules,
// so the pool is cached on globalThis to avoid leaking connections.
const g = globalThis as unknown as { __tfSql?: postgres.Sql };

function get(): postgres.Sql {
  if (g.__tfSql) return g.__tfSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. See .env.example.');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  g.__tfSql = postgres(url, {
    ssl: local ? false : 'require', // Supabase requires TLS
    prepare: false, // required for Supabase's transaction pooler (port 6543)
    max: process.env.NODE_ENV === 'production' ? 5 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    transform: { undefined: null },
    // Keep DATE columns as 'YYYY-MM-DD' strings — no timezone shifting
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
  return g.__tfSql;
}

// Lazy proxy: the pool is created on first query, so `next build`
// never needs a database connection.
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_t, _this, args: unknown[]) => (get() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const s = get() as unknown as Record<string | symbol, unknown>;
    const v = s[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
});

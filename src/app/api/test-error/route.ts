import { appEnv } from '@/lib/env';
import { fail } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Test-only: throws a server error so the release check can prove errors reach /admin/errors.
// Exists only when E2E_ERROR_ROUTE=1 and never in production; otherwise it's a plain 404.
export async function GET() {
  if (process.env.E2E_ERROR_ROUTE !== '1' || appEnv() === 'production') return fail('Not found.', 404);
  throw new Error('Test error from the release check');
}

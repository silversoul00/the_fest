// Next.js calls onRequestError for every uncaught server error (pages, route handlers, server actions).
// We store it in app_errors (see /admin/errors) and email the admins at most once every 15 minutes.
export function register() {}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  // Written as `=== 'nodejs'` around the import so the edge build drops it (the error log needs Node: database, crypto).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Redirects and 404s are thrown as errors internally; they're not failures.
    const digest = (err as { digest?: string })?.digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') || digest === 'NEXT_NOT_FOUND') return;
    const { reportError } = await import('./lib/errors');
    await reportError(err, `${context.routeType} ${context.routePath}`, { path: `${request.method} ${request.path}`.slice(0, 500), digest });
  }
}

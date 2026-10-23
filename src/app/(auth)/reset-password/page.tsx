import Link from 'next/link';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { ActionForm, Submit } from '@/components/forms';
import { resetPassword } from '../reset-actions';

export const metadata = { title: 'Set a new password' };

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  // Check the link before showing the form, so nobody types a new password into a dead link (it is still checked again on save)
  const usable = !!token && /^[A-Za-z0-9_-]{20,100}$/.test(token) && (await sql`
    select 1 from password_resets where token_hash = ${createHash('sha256').update(token).digest('hex')}
      and used_at is null and expires_at > now()`).length > 0;
  return (
    <main className="auth-shell">
      <span className="ghost-word" aria-hidden>FEST</span>
      <div className="stack g24 narrow" style={{ width: '100%', position: 'relative' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <h1 className="h1">New<br />password.</h1>
        {!token ? (
          <div className="alert error">This link is missing its code. <Link className="accent" href="/forgot-password">Ask for a new one</Link>.</div>
        ) : !usable ? (
          <div className="alert error" role="alert">This reset link has expired or was already used. <Link className="accent" href="/forgot-password">Ask for a new one</Link>.</div>
        ) : (
          <ActionForm action={resetPassword}>
            <input type="hidden" name="token" value={token} />
            <label className="field"><span>New password</span>
              <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
            </label>
            <label className="field"><span>Type it again</span>
              <input className="input" type="password" name="confirm" autoComplete="new-password" minLength={8} required />
            </label>
            <Submit pendingText="Saving…">Save &amp; log in →</Submit>
            <p className="xs muted">You&apos;ll be logged out on every other device.</p>
          </ActionForm>
        )}
      </div>
    </main>
  );
}

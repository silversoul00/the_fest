import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser, PORTAL } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/forms';
import { login } from '../actions';

export const metadata = { title: 'Log in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getUser();
  if (user) redirect(next?.startsWith('/') ? next : PORTAL[user.role]);

  return (
    <main className="auth-shell">
      <span className="ghost-word" aria-hidden>FEST</span>
      <div className="stack g24 narrow" style={{ width: '100%', position: 'relative' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <div>
          <h1 className="h1">Welcome<br />back.</h1>
          <p className="soft mt12">Log in to your account — you&apos;ll land straight in your portal.</p>
        </div>
        <ActionForm action={login}>
          <input type="hidden" name="next" value={next ?? ''} />
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" autoComplete="email" required placeholder="you@college.edu" />
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" name="password" autoComplete="current-password" required placeholder="••••••••" />
          </label>
          <Submit pendingText="Signing in…">Log in →</Submit>
        </ActionForm>
        <div className="stack g8 small soft" style={{ textAlign: 'center' }}>
          <span>New here? <Link className="accent" href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link></span>
          <span>Volunteering at a gate? <Link className="c-green" href="/scan/login">Open the scanner</Link></span>
        </div>
      </div>
    </main>
  );
}

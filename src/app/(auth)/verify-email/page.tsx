import Link from 'next/link';
import { consumeVerification } from '@/lib/verify';
import { getUser, PORTAL } from '@/lib/auth';

export const metadata = { title: 'Confirm email' };

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const ok = !!(await consumeVerification(token));
  const user = await getUser();
  return (
    <main className="auth-shell">
      <span className="ghost-word" aria-hidden>FEST</span>
      <div className="stack g24 narrow" style={{ width: '100%', position: 'relative' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <h1 className="h1">{ok ? <>Email<br />confirmed.</> : <>Link<br />expired.</>}</h1>
        {ok
          ? <div className="alert ok">Thanks — your email is confirmed. Anything a fest has shared with this address is now unlocked.</div>
          : <div className="alert error">This link is invalid, expired or already used. Log in and ask for a new one from the banner at the top.</div>}
        <Link className="btn block" href={user ? PORTAL[user.role] : '/login'}>{user ? 'Continue →' : 'Log in →'}</Link>
      </div>
    </main>
  );
}

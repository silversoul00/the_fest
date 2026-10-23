import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser, PORTAL } from '@/lib/auth';
import { safeNext } from '@/lib/format';
import { SignupForm } from './SignupForm';

export const metadata = { title: 'Create account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ role?: string; next?: string }> }) {
  const { role, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const user = await getUser();
  if (user) redirect(PORTAL[user.role]);
  const initial = role === 'organizer' || role === 'sponsor' ? role : 'student';

  return (
    <main className="auth-shell">
      <span className="ghost-word" aria-hidden>FEST</span>
      <div className="stack g24 narrow" style={{ width: '100%', position: 'relative' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <div>
          <h1 className="h1">Join<br />the fest.</h1>
          <p className="soft mt12">Pick your role once — we&apos;ll remember it.</p>
        </div>
        <SignupForm initialRole={initial} next={next} />
        <p className="small soft" style={{ textAlign: 'center' }}>
          Already have an account? <Link className="accent" href="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}

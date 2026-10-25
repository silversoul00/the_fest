import Link from 'next/link';
import { ActionForm, Submit } from '@/components/forms';
import { requestReset } from '../reset-actions';

export const metadata = { title: 'Forgot password' };

export default function ForgotPassword() {
  return (
    <main className="auth-shell">
      <span className="ghost-word" aria-hidden>FEST</span>
      <div className="stack g24 narrow" style={{ width: '100%', position: 'relative' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <div>
          <h1 className="h1">Forgot<br />password?</h1>
          <p className="soft mt12">Enter your email and we&apos;ll send you a link to set a new one.</p>
        </div>
        <ActionForm action={requestReset}>
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" autoComplete="email" required placeholder="you@college.edu" />
          </label>
          <Submit pendingText="Sending…">Send reset link →</Submit>
        </ActionForm>
        <p className="small soft" style={{ textAlign: 'center' }}><Link className="accent" href="/login">Back to log in</Link></p>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { ActionForm, Submit } from '@/components/forms';
import { scannerLogin } from '../actions';

export const metadata = { title: 'Gate scanner' };

// No "already signed in" shortcut here on purpose: the scanner always re-authenticates.
export default function ScannerLogin() {
  return (
    <main className="auth-shell" style={{ ['--accent' as string]: 'var(--green)' }}>
      <span className="ghost-word" aria-hidden>GATE</span>
      <div className="stack g24 narrow" style={{ width: '100%', position: 'relative' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <div>
          <span className="badge green">📷 Gate scanner</span>
          <h1 className="h1 mt16">Scanner<br /><span className="c-green">access.</span></h1>
          <p className="soft mt12">Log in with the email your organizer added to the gate team. You&apos;ll be asked again every time the scanner is opened.</p>
        </div>
        <ActionForm action={scannerLogin}>
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" autoComplete="username" required />
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" name="password" autoComplete="current-password" required />
          </label>
          <Submit className="btn block green" pendingText="Unlocking…">Unlock scanner →</Submit>
        </ActionForm>
        <p className="small soft" style={{ textAlign: 'center' }}>No account? <Link className="c-green" href="/signup?next=/scan/login">Sign up</Link> with the email you were added with.</p>
      </div>
    </main>
  );
}

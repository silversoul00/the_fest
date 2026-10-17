import Link from 'next/link';
import { checkTicketKeys } from '@/lib/ticket-crypto';
import { KeyGen } from './KeyGen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ticket signing keys', robots: { index: false } };

// First-run helper: makes the ticket signing keys on your phone or laptop, inside the browser.
// The private key never leaves the browser. Once valid keys are set, this page shows nothing else.
export default function SetupKeys() {
  const state = checkTicketKeys();
  return (
    <main className="auth-shell">
      <div className="stack g16 narrow" style={{ maxWidth: 520, width: '100%' }}>
        <Link href="/" className="logo">THE FEST</Link>
        <h1 className="h2">Ticket signing keys</h1>
        {state === 'ok' ? (
          <div className="alert ok">Keys are already set. Nothing to do here.</div>
        ) : (
          <>
            {state === 'mismatch' && <div className="alert error">The two keys set now don’t belong together. Replace both with a new pair.</div>}
            {(state === 'invalid' || state === 'public_invalid') && <div className="alert error">A key is set but can’t be read. Replace both with a new pair.</div>}
            <KeyGen />
          </>
        )}
      </div>
    </main>
  );
}

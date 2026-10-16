export const metadata = { title: 'Offline' };

export default function Offline() {
  return (
    <main className="auth-shell">
      <div className="stack g16 narrow" style={{ textAlign: 'center', alignItems: 'center' }}>
        <div className="logo">THE FEST</div>
        <h1 className="h2">You&apos;re offline</h1>
        <p className="soft">Check your connection and try again. Tickets you&apos;ve opened recently may still show from your screenshots.</p>
      </div>
    </main>
  );
}

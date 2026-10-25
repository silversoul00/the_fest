'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth-shell">
      <div className="stack g16 narrow" style={{ textAlign: 'center', alignItems: 'center' }}>
        <div className="logo">THE FEST</div>
        <h1 className="h2">Something went wrong</h1>
        <p className="soft">It&apos;s on us. Try again — if it keeps happening, refresh the page.</p>
        <button className="btn" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}

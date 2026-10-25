import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="auth-shell">
      <span className="ghost-word" aria-hidden>404</span>
      <div className="stack g16 narrow" style={{ textAlign: 'center', alignItems: 'center', position: 'relative' }}>
        <div className="logo">THE FEST</div>
        <h1 className="h1">Lost the crowd?</h1>
        <p className="soft">This page doesn&apos;t exist — or you don&apos;t have access to it.</p>
        <Link href="/" className="btn">Back to THE FEST</Link>
      </div>
    </main>
  );
}

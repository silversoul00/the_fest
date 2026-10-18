'use client';
import { SAVED_KEY } from '@/components/LiveQR';

/** Log out, and forget the tickets saved on this phone for /offline. */
export function LogoutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={async () => { try { localStorage.removeItem(SAVED_KEY); } catch {} await action(); }}>
      <button className="btn danger block" type="submit">Log out</button>
    </form>
  );
}

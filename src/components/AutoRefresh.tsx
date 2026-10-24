'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Re-fetches the server component every N seconds while the tab is visible.
 * With stopAfterMinutes, polling stops after that long (every refresh costs a server call,
 * and a phone left open in a queue shouldn't poll forever) and a "Tap to refresh" button appears.
 */
export function AutoRefresh({ seconds = 10, stopAfterMinutes }: { seconds?: number; stopAfterMinutes?: number }) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (stopped) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (stopAfterMinutes && Date.now() - started >= stopAfterMinutes * 60_000) {
        clearInterval(id);
        setStopped(true);
        return;
      }
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds, stopAfterMinutes, stopped]);

  if (!stopped) return null;
  return (
    <button type="button" className="btn sm outline block" onClick={() => { router.refresh(); setStopped(false); }}>
      ↻ Tap to refresh
    </button>
  );
}

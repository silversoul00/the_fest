'use client';
import { use } from 'react';

/**
 * Root-layout wrapper: React starts hydrating a page only once the whole HTML document (with every inline chunk of
 * page data) has arrived.
 *
 * Why: on a slow connection the page's data (the RSC payload) arrives in pieces after the HTML, and Next.js starts
 * hydrating before it is complete. React 19.3 then reaches a piece that hasn't arrived yet, and when it retries it loses
 * its place in the HTML and throws error #418 (Sales, Analytics and other big pages —
 * docs/team/reviews/2026-10-23-bugfix-test-1.md F2). Waiting at the very top, before React enters any HTML element,
 * makes the retry start cleanly from the top. Meanwhile the server's HTML is already on screen; only taps wait a moment.
 *
 * It renders nothing of its own and never waits on the server or on in-app navigations (the document is complete by
 * then), so the HTML, streaming, 404s and redirects are unchanged.
 */
export function HydrationGate({ children }: { children: React.ReactNode }) {
  const p = whenDocumentDone();
  if (p) use(p);
  return children;
}

let documentDone: Promise<void> | null = null;
/** null when there's nothing to wait for; otherwise resolves just after the HTML has been parsed. */
function whenDocumentDone(): Promise<void> | null {
  if (typeof window === 'undefined' || document.readyState !== 'loading') return null;
  // setTimeout: let Next.js hand the last data chunks (pushed by inline scripts) to React before hydrating
  return (documentDone ??= new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 0), { once: true });
  }));
}

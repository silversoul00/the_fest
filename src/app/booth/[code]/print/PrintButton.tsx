'use client';
export function PrintButton({ label = '🖨 Print poster' }: { label?: string }) {
  return <button className="btn no-print" onClick={() => window.print()}>{label}</button>;
}

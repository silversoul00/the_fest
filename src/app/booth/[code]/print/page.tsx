import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PrintButton } from './PrintButton';

export const metadata = { title: 'Booth QR poster' };

// Printable A4 poster for the sponsor's booth. Visible to the fest's organizer and the sponsor.
export default async function BoothPoster({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) notFound();
  const [b] = await sql<{ brand: string; fest_name: string; organizer_id: string; email: string }[]>`
    select s.brand, s.email::text, f.name as fest_name, f.organizer_id from sponsors s join fests f on f.id = s.fest_id where s.booth_code = ${code}`;
  if (!b || (b.organizer_id !== user.id && b.email !== user.email)) notFound();

  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/booth/${code}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'H', color: { dark: '#080808', light: '#FFFFFF' } });

  return (
    <main style={{ background: '#fff', color: '#080808', minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <style>{`@media print { .no-print { display: none !important } @page { size: A4; margin: 14mm } }`}</style>
      <div className="stack g24" style={{ alignItems: 'center', textAlign: 'center', maxWidth: 560 }}>
        <div className="label" style={{ color: '#666' }}>{b.fest_name}</div>
        <div className="h1" style={{ color: '#080808' }}>{b.brand}</div>
        <div style={{ width: 'min(380px, 80vw)' }} dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="display" style={{ fontSize: 34 }}>Scan to check in at our booth</div>
        <div className="mono small" style={{ color: '#666' }}>Powered by THE FEST</div>
        <PrintButton />
      </div>
    </main>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { UpiPay } from '../../fests/[slug]/BuyTickets';

export function ResumeUpi({ upi, entry = false }: { upi: { orderId: string; amount: number; vpa: string; payee: string; note: string; link: string }; entry?: boolean }) {
  const router = useRouter();
  // An event entry (v2.8) lives on My events; "confirmed" only when the payment was really seen
  return <UpiPay upi={upi} entry={entry} onDone={(status) => router.push(entry ? (status === 'confirmed' ? '/my-events?paid=1' : '/my-events?utr=1') : `/tickets?order=${upi.orderId}`)} />;
}

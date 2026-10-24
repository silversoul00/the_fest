'use client';
import { useRouter } from 'next/navigation';
import { UpiPay } from '../../fests/[slug]/BuyTickets';

export function ResumeUpi({ upi }: { upi: { orderId: string; amount: number; vpa: string; payee: string; note: string; link: string } }) {
  const router = useRouter();
  return <UpiPay upi={upi} onDone={() => router.push(`/tickets?order=${upi.orderId}`)} />;
}

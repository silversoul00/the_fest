import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { createFest } from '../actions';
import { FestForm } from '../FestForm';
import { canManage } from '@/lib/queries';
import { VerifyNotice } from '@/components/VerifyNotice';

export const metadata = { title: 'New fest' };

export default async function NewFest() {
  const user = await requireUser('organizer');
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from fests f where ${canManage(user)}`;
  return (
    <main className="wrap" style={{ maxWidth: 640, padding: '24px var(--gutter) 64px' }}>
      <div className="row between mb24">
        <Link href="/organizer" className="logo">THE FEST</Link>
        {n > 0 && <Link href="/organizer" className="label">Cancel</Link>}
      </div>
      {!user.verified && <VerifyNotice email={user.email} />}
      <span className="kicker">{n === 0 ? `Welcome, ${user.name.split(' ')[0]}` : 'New fest'}</span>
      <h1 className="h1 mt8 mb8">Set up your fest</h1>
      <p className="soft mb24">Takes about 3 minutes. It stays a private draft until you publish.</p>
      <FestForm action={createFest} create />
    </main>
  );
}

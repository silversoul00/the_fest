import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { AdminNav } from './AdminNav';

export const metadata = { title: 'Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <Link href="/admin" className="logo">THE FEST <span className="c-red" style={{ fontSize: 14, letterSpacing: '.2em' }}>ADMIN</span></Link>
          <span className="small soft hide-sm">{admin.name}</span>
        </div>
      </header>
      <AdminNav />
      <main className="wrap page stack g16">{children}</main>
    </>
  );
}

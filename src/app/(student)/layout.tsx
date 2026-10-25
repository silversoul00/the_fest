import { getUser } from '@/lib/auth';
import { SiteFooter } from '@/components/Legal';
import { VerifyNotice } from '@/components/VerifyNotice';
import { StudentChrome } from '@/components/StudentChrome';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <>
      <StudentChrome signedIn={!!user} />
      <main className="page">{user && !user.verified && <div className="wrap"><VerifyNotice email={user.email} /></div>}{children}<SiteFooter /></main>
    </>
  );
}

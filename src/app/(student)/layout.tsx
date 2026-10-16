import { getUser } from '@/lib/auth';
import { SiteFooter } from '@/components/Legal';
import { StudentChrome } from '@/components/StudentChrome';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <>
      <StudentChrome signedIn={!!user} />
      <main className="page">{children}<SiteFooter /></main>
    </>
  );
}

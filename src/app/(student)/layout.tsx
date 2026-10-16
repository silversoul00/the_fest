import { getUser } from '@/lib/auth';
import { StudentChrome } from '@/components/StudentChrome';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <>
      <StudentChrome signedIn={!!user} />
      <main className="page">{children}</main>
    </>
  );
}

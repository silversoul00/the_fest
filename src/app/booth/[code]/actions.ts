'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function recordBoothVisit(fd: FormData) {
  const code = String(fd.get('code') ?? '');
  const user = await requireUser();
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(code)) redirect('/');
  await sql`insert into sponsor_visits (sponsor_id, user_id)
            select id, ${user.id} from sponsors where booth_code = ${code}
            on conflict (sponsor_id, user_id) do nothing`;
  redirect(`/booth/${code}?done=1`);
}

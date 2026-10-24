'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isUuid } from '@/lib/http';
import { BOOTH_CODE_RE, COURSE_MAX, LEAD_NOTICE_VERSION, leadsReady } from '@/lib/sponsor-leads';

export async function recordBoothVisit(fd: FormData) {
  const code = String(fd.get('code') ?? '');
  const user = await requireUser();
  if (!BOOTH_CODE_RE.test(code)) redirect('/');
  await sql`insert into sponsor_visits (sponsor_id, user_id)
            select id, ${user.id} from sponsors where booth_code = ${code}
            on conflict (sponsor_id, user_id) do nothing`;
  redirect(`/booth/${code}?done=1`);
}

/**
 * The student chooses to share their contact with this booth's brand. Never needed for check-in.
 * Needs the "I am 18 or older" tick and a confirmed email (so nobody can hand a brand someone else's address).
 * Records the booth visit too, in the same transaction. Sharing again after stopping refills the row with a new time.
 */
export async function shareLead(fd: FormData) {
  const code = String(fd.get('code') ?? '');
  const user = await requireUser();
  if (!BOOTH_CODE_RE.test(code)) redirect('/');
  const back = (err: string) => redirect(`/booth/${code}?err=${err}`);
  if (fd.get('adult') !== 'yes') back('adult');
  if (!user.verified) back('verify');
  const course = String(fd.get('course_year') ?? '').trim().replace(/\s+/g, ' ');
  if (course.length > COURSE_MAX) back('course');
  if (!(await leadsReady())) back('off');
  const withPhone = fd.get('phone') === 'yes';

  await sql.begin(async (tx) => {
    const [s] = await tx<{ id: string }[]>`select id from sponsors where booth_code = ${code}`;
    if (!s) return;
    await tx`insert into sponsor_visits (sponsor_id, user_id) values (${s.id}, ${user.id}) on conflict (sponsor_id, user_id) do nothing`;
    // Snapshot from the account as it is now (not from the form).
    await tx`
      insert into sponsor_leads (sponsor_id, user_id, name, email, phone, college, course_year, notice_version)
      select ${s.id}, u.id, u.name, u.email, case when ${withPhone} then nullif(trim(u.phone), '') end,
             nullif(trim(u.college), ''), ${course || null}, ${LEAD_NOTICE_VERSION}
      from users u where u.id = ${user.id}
      on conflict (sponsor_id, user_id) do update set
        name = excluded.name, email = excluded.email, phone = excluded.phone, college = excluded.college,
        course_year = excluded.course_year, notice_version = excluded.notice_version,
        shared_at = case when sponsor_leads.withdrawn_at is null then sponsor_leads.shared_at else now() end,
        withdrawn_at = null`;
  });
  redirect(`/booth/${code}?shared=1`);
}

/** Stop sharing with a brand (from the booth page or My account). Only the email stays, for the brand's remove list. */
export async function stopSharing(fd: FormData) {
  const user = await requireUser();
  const sponsorId = String(fd.get('sponsorId') ?? '');
  const from = String(fd.get('from') ?? '');
  if (!isUuid(sponsorId)) redirect('/');
  if (await leadsReady()) {
    await sql`update sponsor_leads set name = null, phone = null, college = null, course_year = null, withdrawn_at = now()
              where sponsor_id = ${sponsorId} and user_id = ${user.id} and withdrawn_at is null`;
  }
  if (BOOTH_CODE_RE.test(from)) redirect(`/booth/${from}?stopped=1`);
  redirect('/me?stopped=1');
}

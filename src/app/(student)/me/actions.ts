'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ALLERGY_MAX, BLOOD_GROUPS, utf8 } from '@/lib/qr2-format';
import type { ActionState } from '@/lib/types';

const FIRST_AID_CONSENT_VERSION = 'v1 (2026-10-18)';

/** Save the student's optional first-aid card. Adults only; both ticks required. */
export async function saveFirstAid(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser('student');
  const blood = String(fd.get('blood_group') ?? '');
  const allergies = String(fd.get('allergies') ?? '').trim().replace(/\s+/g, ' ');
  let phone = String(fd.get('emergency_phone') ?? '').replace(/\D/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
  if (fd.get('consent') !== 'on' || fd.get('adult') !== 'on') return { error: 'Tick both boxes to save. The first-aid card is for adults (18 or older) only.' };
  if (!(BLOOD_GROUPS as readonly string[]).includes(blood)) return { error: 'Pick your blood group (or “Don’t know”).' };
  if (utf8(allergies).length > ALLERGY_MAX) return { error: `Keep allergies short — ${ALLERGY_MAX} letters at most.` };
  if (!/^\d{10}$/.test(phone)) return { error: 'Enter a 10-digit emergency phone number.' };
  await sql`insert into medical_profiles (user_id, blood_group, allergies, emergency_phone, consent_version, consented_at)
            values (${user.id}, ${blood}, ${allergies}, ${phone}, ${FIRST_AID_CONSENT_VERSION}, now())
            on conflict (user_id) do update set blood_group = excluded.blood_group, allergies = excluded.allergies,
              emergency_phone = excluded.emergency_phone, consent_version = excluded.consent_version, consented_at = now()`;
  revalidatePath('/me');
  return { ok: true, message: 'First-aid card saved. Ticket QR codes you open from now on carry it.' };
}

export async function deleteFirstAid() {
  const user = await requireUser('student');
  await sql`delete from medical_profiles where user_id = ${user.id}`;
  revalidatePath('/me');
}

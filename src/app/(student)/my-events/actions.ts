'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { eventsReady, EVENTS_MISSING } from '@/lib/fest-access';
import { inviteMember, leaveTeam, registerEntry, removeMember, respondInvite, submitEntry, withdrawEntry } from '@/lib/events';
import { isUuid } from '@/lib/http';
import { siteUrl } from '@/lib/env';
import { afterResponse } from '@/lib/errors';
import { sendEmail } from '@/lib/mail';
import type { ActionState } from '@/lib/types';

/*
 * Student side of fest events (v2.8). Every action starts with requireUser() and the library re-checks that the
 * caller is the captain / the invited email / a member (scripts/check-guards.mjs checks requireUser is called).
 */
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const done = (r: { ok: true; message: string } | { error: string }): ActionState => {
  revalidatePath('/my-events');
  revalidatePath('/fests', 'layout');
  return 'error' in r ? { error: r.error } : { ok: true, message: r.message };
};

/** Register (solo) / Create team — from the event page. A paid entry goes on to My events to pay. */
export async function registerForEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!(await eventsReady())) return { error: EVENTS_MISSING };
  const eventId = s(fd, 'eventId');
  if (!isUuid(eventId)) return { error: 'Event not found.' };
  const r = await registerEntry(user, eventId, s(fd, 'team_name'));
  done(r);
  if ('error' in r) return { error: r.error };
  redirect(`/my-events?entry=${r.regId}`);
}

export async function inviteToTeam(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const regId = s(fd, 'regId');
  if (!isUuid(regId) || !(await eventsReady())) return { error: 'Entry not found.' };
  const r = await inviteMember(user, regId, s(fd, 'email'));
  if ('invite' in r && r.invite) {
    const inv = r.invite;
    await afterResponse('team invite email', () => sendEmail(inv.email, `${user.name} invited you to a team for ${inv.event}`, [
      `${user.name} invited you to their team for ${inv.event} at ${inv.fest} on THE FEST.`,
      '',
      `Accept or decline in My events (log in or sign up with this email and confirm it): ${siteUrl()}/my-events`,
      '',
      '— THE FEST',
    ].join('\n')));
  }
  return done(r);
}

export async function answerInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = s(fd, 'memberId');
  if (!isUuid(id) || !(await eventsReady())) return { error: 'Invite not found.' };
  return done(await respondInvite(user, id, s(fd, 'answer') === 'accept'));
}

export async function leaveEventTeam(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const regId = s(fd, 'regId');
  if (!isUuid(regId) || !(await eventsReady())) return { error: 'Entry not found.' };
  return done(await leaveTeam(user, regId));
}

export async function removeTeamMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = s(fd, 'memberId');
  if (!isUuid(id) || !(await eventsReady())) return { error: 'Member not found.' };
  return done(await removeMember(user, id));
}

export async function submitTeam(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const regId = s(fd, 'regId');
  if (!isUuid(regId) || !(await eventsReady())) return { error: 'Entry not found.' };
  return done(await submitEntry(user, regId));
}

export async function withdrawMyEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const regId = s(fd, 'regId');
  if (!isUuid(regId) || !(await eventsReady())) return { error: 'Entry not found.' };
  return done(await withdrawEntry(regId, { userId: user.id }));
}

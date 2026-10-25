// Pure helpers for fest events (v2.8) — shared by server and client components.
import { rupees } from './format';

/** Fixed category list (Harshith, Oct 25 2026). */
export const EVENT_CATEGORIES = ['cultural', 'management', 'technical', 'sports', 'literary', 'gaming', 'other'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  cultural: 'Cultural', management: 'Management', technical: 'Technical', sports: 'Sports',
  literary: 'Literary', gaming: 'Gaming', other: 'Other',
};
export const isEventCategory = (c: unknown): c is EventCategory => typeof c === 'string' && (EVENT_CATEGORIES as readonly string[]).includes(c);

export const LIMITS = { title: 80, venue: 120, rules: 3000, prize: 200, teamName: 60, maxTeam: 20, maxSlots: 5000, maxPricePaise: 10_000_00 } as const;

/** "Solo" / "Team of 2–4" / "Team of 3". */
export const teamText = (min: number, max: number) => (max <= 1 ? 'Solo' : min === max ? `Team of ${max}` : `Team of ${min}–${max}`);

/** "Free" / "Free · fest ticket needed" / "₹200 + ₹5 fee" (per team when it's a team event). */
export function feeText(pricePaise: number, needsTicket: boolean, feePaise: number, team = false): string {
  if (pricePaise <= 0) return needsTicket ? 'Free · fest ticket needed' : 'Free';
  return `${rupees(pricePaise)} + ${rupees(feePaise)} fee${team ? ' per team' : ''}${needsTicket ? ' · fest ticket needed' : ''}`;
}

/** Slot state shown to students. */
export function slotState(taken: number, slots: number, deadline: Date | string, now = Date.now()): { kind: 'open' | 'full' | 'closed'; text: string } {
  if (new Date(deadline).getTime() <= now) return { kind: 'closed', text: 'Closed' };
  const left = Math.max(slots - taken, 0);
  if (left <= 0) return { kind: 'full', text: 'Full' };
  return { kind: 'open', text: `${left} slot${left === 1 ? '' : 's'} left` };
}

/** "Same college" when mixed colleges aren't allowed: a normalised free-text match (blank never matches). */
export const collegeKey = (c: string | null | undefined) => (c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const sameCollege = (a: string | null | undefined, b: string | null | undefined) => !!collegeKey(a) && collegeKey(a) === collegeKey(b);

/** IST date 'YYYY-MM-DD' and time 'HH:MM' of a timestamp (for form defaults). */
export const istDate = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const istTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });

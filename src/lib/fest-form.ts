import type { Fest } from './types';

export type FestFormFields = Pick<Fest, 'id' | 'slug' | 'emoji' | 'accent' | 'name' | 'college' | 'city' | 'venue' | 'category' | 'starts_on' | 'ends_on' | 'description' | 'capacity'>;
export const festFormFields = (f: Fest): FestFormFields => ({
  id: f.id, slug: f.slug, emoji: f.emoji, accent: f.accent, name: f.name, college: f.college, city: f.city, venue: f.venue,
  category: f.category, starts_on: f.starts_on, ends_on: f.ends_on, description: f.description, capacity: f.capacity,
});

/** New fests (and renamed ones) are checked by THE FEST before tickets go on sale. Server-side only (reads the environment). */
export const approvalRequired = () => process.env.REQUIRE_FEST_APPROVAL !== 'false';

/**
 * Renaming a fest THE FEST already approved clears the approval (stops "get approved as a real fest, then rename it
 * and sell"). Harshith, Oct 24 2026: every rename of an approved fest is re-checked, even with NO tickets sold
 * (docs/team/BRIEF.md). true = that rule; false would limit it to fests that have sold tickets.
 */
export const RENAME_REVIEW_WITHOUT_TICKETS = true;

/** What renaming does to the fest: 'now' = a live fest goes back to review at once; 'next' = a draft/ended fest goes to review on the next Publish/Reopen. */
export type RenameReview = 'now' | 'next' | null;

/** Does a rename clear the approval? (`approved` = THE FEST approved this fest and approval is switched on.) */
export function renameClearsApproval(approved: boolean, holders: number): boolean {
  return approved && (holders > 0 || RENAME_REVIEW_WITHOUT_TICKETS);
}

/** The note THE FEST's admin sees, and how to recognise it later (so it isn't wiped before the admin has seen it). */
const RENAME_NOTE = /^Renamed from “([\s\S]*?)” to “/;
export const isRenameNote = (note: string | null | undefined) => !!note && RENAME_NOTE.test(note);
export function renameNote(oldName: string, newName: string, holders: number, prevNote: string | null): string {
  const first = prevNote?.match(RENAME_NOTE)?.[1] ?? oldName; // renamed twice before the admin looked: keep the original name
  return `Renamed from “${first}” to “${newName}” ${holders ? 'after tickets were sold' : 'after THE FEST approved it'} — please check again.`.slice(0, 300);
}

/** The warning shown above Save (and in the server's reply when the "I understand" tick is missing). */
export function changeNotice({ holders, review }: { holders: number; review: RenameReview }): string {
  const mail = holders ? `emails ${holders} ticket holder${holders === 1 ? '' : 's'} what changed` : '';
  if (review === 'now') return `This sends the fest back to admin review (ticket sales pause until THE FEST approves it)${mail ? ` and ${mail}` : ''}.`;
  if (review === 'next') return `The new name needs a fresh check by THE FEST: the next Publish sends the fest to admin review first.${mail ? ` This also ${mail}.` : ''}`;
  return `This ${mail}.`;
}

/** For the settings form: what a rename of this fest would do right now. */
export function renameReviewFor(f: { status: string; approved_at: Date | null; review_note: string | null }, holders: number): RenameReview {
  if (!approvalRequired() || f.status === 'cancelled' || f.status === 'review') return null;
  if (renameClearsApproval(!!f.approved_at, holders)) return f.status === 'live' ? 'now' : 'next';
  return isRenameNote(f.review_note) ? 'next' : null; // renamed earlier and not approved since
}

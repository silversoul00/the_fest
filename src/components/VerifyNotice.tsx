import { ActionForm, Submit } from '@/components/forms';
import { resendVerification } from '@/app/(auth)/verify-actions';

/** Shown to signed-in users who haven't confirmed their email yet. */
export function VerifyNotice({ email }: { email: string }) {
  return (
    <div className="alert info verify-notice" style={{ marginBottom: 16 }}>
      <div><b>Confirm your email.</b> We sent a link to {email}. Fests can only share access (co-organizer, gate team, sponsor dashboard) with a confirmed email.</div>
      <ActionForm action={resendVerification} className="row g8 mt8">
        <Submit className="btn sm outline" pendingText="Sending…">Send the link again</Submit>
      </ActionForm>
    </div>
  );
}

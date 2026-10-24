import { ActionForm, Submit } from '@/components/forms';
import { resendVerification } from '@/app/(auth)/verify-actions';

/** Shown to signed-in users who haven't confirmed their email yet. */
export function VerifyNotice({ email, why }: { email: string; why?: string }) {
  return (
    <div className="alert info verify-notice" style={{ marginBottom: 16 }}>
      <div><b>Confirm your email.</b> We sent a link to {email}. {why ?? 'Any fest role you’re given (co-organizer, finance, sponsorship, media, judge, volunteer or desk) and brand access start only once this email is confirmed.'}</div>
      <ActionForm action={resendVerification} className="row g8 mt8">
        <Submit className="btn sm outline" pendingText="Sending…">Send the link again</Submit>
      </ActionForm>
    </div>
  );
}

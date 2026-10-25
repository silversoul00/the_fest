'use client';
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/types';

const Pending = createContext(false);

export function Submit({ children, className = 'btn block', pendingText = 'Working…' }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending: formPending } = useFormStatus();
  const ctxPending = useContext(Pending);
  const pending = formPending || ctxPending;
  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <div className="alert error" role="alert">{state.error}</div>;
  if (state.message) return <div className="alert ok" role="status">{state.message}</div>;
  return null;
}

/*
 * Flash: a success message that outlives its form. Some actions remove the very form that ran them (Accept invite,
 * Submit team, Cancel & refund …), so a message inside the form would vanish with it. <ActionForm flash> hands the
 * success message to the page's <FlashMessage /> instead, which sits outside the form.
 */
let flashMsg: string | null = null;
const flashSubs = new Set<() => void>();
const setFlash = (m: string | null) => { flashMsg = m; flashSubs.forEach((f) => f()); };
const subFlash = (f: () => void) => { flashSubs.add(f); return () => { flashSubs.delete(f); }; };

/** Shows the last flashed success message (place it outside the forms that flash). */
export function FlashMessage() {
  const msg = useSyncExternalStore(subFlash, () => flashMsg, () => null);
  useEffect(() => () => setFlash(null), []);   // leaving the page clears it
  if (!msg) return null;
  return (
    <div className="alert ok row between g8" role="status" data-flash>
      <span className="grow wrap-anywhere" style={{ whiteSpace: 'pre-line' }}>{msg}</span>
      <button type="button" className="btn text xs" onClick={() => setFlash(null)} aria-label="Dismiss">✕</button>
    </div>
  );
}

/**
 * <ActionForm action={serverAction}> — runs a server action, shows its error or
 * success message, and KEEPS what the user typed when there's an error
 * (React's built-in <form action> clears every field after submitting).
 * Pass resetOnSuccess for "add item" forms that should clear after saving.
 * Redirects thrown by the action (e.g. after login) still navigate normally.
 * Pass flash when the action can remove its own form: success goes to the page's <FlashMessage />, errors stay inline.
 */
export function ActionForm({
  action, children, className = 'form', resetOnSuccess = false, flash = false,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  flash?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    flash
      ? async (s: ActionState, fd: FormData) => {
          setFlash(null);
          const r = await action(s, fd);
          if (r?.ok && r.message) setFlash(r.message);   // runs even if this form is gone after the refresh
          return r;
        }
      : action,
    null,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <Pending.Provider value={isPending}>
        <FormMessage state={flash && state?.ok ? null : state} />
        {children}
      </Pending.Provider>
    </form>
  );
}

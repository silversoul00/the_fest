'use client';
import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from 'react';
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

/**
 * <ActionForm action={serverAction}> — runs a server action, shows its error or
 * success message, and KEEPS what the user typed when there's an error
 * (React's built-in <form action> clears every field after submitting).
 * Pass resetOnSuccess for "add item" forms that should clear after saving.
 * Redirects thrown by the action (e.g. after login) still navigate normally.
 */
export function ActionForm({
  action, children, className = 'form', resetOnSuccess = false,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, null);
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
        <FormMessage state={state} />
        {children}
      </Pending.Provider>
    </form>
  );
}

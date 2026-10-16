'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/types';

export function Submit({ children, className = 'btn block', pendingText = 'Working…' }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
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
 * <ActionForm action={serverAction}> — wraps useActionState, shows errors,
 * and optionally resets after success (for "add item" forms).
 */
export function ActionForm({
  action, children, className = 'form', resetOnSuccess = false,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      <FormMessage state={state} />
      {children}
    </form>
  );
}

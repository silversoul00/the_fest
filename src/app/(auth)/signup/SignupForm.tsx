'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/forms';
import { signup } from '../actions';

const ROLES = [
  { v: 'student', e: '🎓', l: 'Student' },
  { v: 'organizer', e: '⚡', l: 'Organizer' },
  { v: 'sponsor', e: '🏷️', l: 'Sponsor' },
] as const;

export function SignupForm({ initialRole, next }: { initialRole: string; next: string }) {
  const [role, setRole] = useState(initialRole);
  return (
    <ActionForm action={signup}>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <span>I am a</span>
        <div className="seg" role="radiogroup">
          {ROLES.map((r) => (
            <label key={r.v}>
              <input type="radio" name="role" value={r.v} checked={role === r.v} onChange={() => setRole(r.v)} />
              <span className="e">{r.e}</span>{r.l}
            </label>
          ))}
        </div>
      </div>
      <label className="field"><span>{role === 'sponsor' ? 'Your name' : 'Full name'}</span>
        <input className="input" name="name" autoComplete="name" required placeholder="Your name" />
      </label>
      <label className="field"><span>{role === 'sponsor' ? 'Work email' : 'Email'}</span>
        <input className="input" type="email" name="email" autoComplete="email" required placeholder={role === 'sponsor' ? 'you@brand.com' : 'you@college.edu'} />
      </label>
      {role !== 'sponsor' && (
        <label className="field"><span>College</span>
          <input className="input" name="college" autoComplete="organization" placeholder="e.g. Christ University" />
        </label>
      )}
      <label className="field"><span>Phone (optional)</span>
        <input className="input" type="tel" name="phone" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" />
      </label>
      <label className="field"><span>Password</span>
        <input className="input" type="password" name="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" />
      </label>
      <Submit pendingText="Creating account…">Create account →</Submit>
      <p className="xs muted">By signing up you agree to the <Link href="/legal/terms" className="soft">terms</Link> and <Link href="/legal/privacy" className="soft">privacy policy</Link>.</p>
      {role === 'sponsor' && (
        <p className="xs muted">Use the email the fest organizer added you with — your sponsored fests appear automatically.</p>
      )}
    </ActionForm>
  );
}

import { sql } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { matchCredits } from '@/lib/upi';
import { parseAlerts } from '@/lib/upi-parse';

// Receives forwarded bank-alert emails for one fest and confirms matching UPI orders.
// Point an inbound-email service at:  {SITE}/api/upi/inbound/{fest.inbound_token}
// Accepts JSON (Postmark: TextBody; generic: text/body/plain), form posts
// (Mailgun: body-plain; SendGrid: text) or a raw text body.
// The token is the only credential — keep it private; reset it from the Payments tab.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return fail('Not found', 404);
  const [f] = await sql<{ id: string; upi_enabled: boolean }[]>`select id, upi_enabled from fests where inbound_token = ${token}`;
  if (!f || !f.upi_enabled) return fail('Not found', 404);

  const type = req.headers.get('content-type') ?? '';
  let text = '';
  try {
    if (type.includes('application/json')) {
      const j = (await req.json()) as Record<string, unknown>;
      text = ['TextBody', 'text', 'body', 'plain', 'Subject', 'subject'].map((k) => (typeof j[k] === 'string' ? (j[k] as string) : '')).join('\n\n');
    } else if (type.includes('form')) {
      const fd = await req.formData();
      text = ['body-plain', 'text', 'stripped-text', 'subject'].map((k) => String(fd.get(k) ?? '')).join('\n\n');
    } else {
      text = await req.text();
    }
  } catch {
    return fail('Unreadable body');
  }
  const credits = parseAlerts(text.slice(0, 100_000));
  if (!credits.length) return json({ ok: true, credits: 0 });
  const r = await matchCredits(f.id, credits, 'email');
  return json({ ok: true, credits: credits.length, matched: r.matched.length, flagged: r.flagged.length, unmatched: r.unmatched.length });
}

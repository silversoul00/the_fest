import { sql } from '@/lib/db';
import { fail, json } from '@/lib/http';
import { matchCredits } from '@/lib/upi';
import { parseAlerts } from '@/lib/upi-parse';

// Bank alert senders whose emails may confirm orders on their own. Anything else is recorded
// but only flagged for the organizer. Override with UPI_ALERT_SENDERS (comma-separated domains).
// The forwarding service should also reject mail that fails SPF/DKIM/DMARC.
const DEFAULT_BANK_DOMAINS = [
  'icicibank.com', 'hdfcbank.net', 'hdfcbank.com', 'sbi.co.in', 'alerts.sbi.co.in', 'axisbank.com', 'kotak.com',
  'kotak.bank.in', 'yesbank.in', 'idfcfirstbank.com', 'indusind.com', 'pnb.co.in', 'bankofbaroda.com', 'bankofbaroda.co.in',
  'canarabank.com', 'unionbankofindia.bank', 'federalbank.co.in', 'aubank.in',
];
function isBankSender(from: string): boolean {
  const m = from.toLowerCase().match(/@([a-z0-9.-]+)>?\s*$/);
  if (!m) return false;
  const domain = m[1];
  const list = (process.env.UPI_ALERT_SENDERS?.split(',') ?? DEFAULT_BANK_DOMAINS).map((d) => d.trim().toLowerCase()).filter(Boolean);
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

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
  // Only the body is parsed — subject lines repeat the amount and would create a second credit.
  const firstText = (vals: unknown[]) => vals.find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? '';
  let text = '';
  let from = '';
  try {
    if (type.includes('application/json')) {
      const j = (await req.json()) as Record<string, unknown>;
      text = firstText([j.TextBody, j.text, j.body, j.plain]);
      const full = j.FromFull as { Email?: unknown } | undefined;
      from = firstText([full?.Email, j.From, j.from, j.sender]);
    } else if (type.includes('form')) {
      const fd = await req.formData();
      text = firstText([fd.get('stripped-text'), fd.get('body-plain'), fd.get('text')]);
      from = firstText([fd.get('sender'), fd.get('from'), fd.get('From')]);
    } else {
      text = await req.text();
    }
  } catch {
    return fail('Unreadable body');
  }
  const trusted = isBankSender(from);
  const credits = parseAlerts(text.slice(0, 100_000));
  if (!credits.length) return json({ ok: true, credits: 0 });
  const r = await matchCredits(f.id, credits, 'email', { trusted });
  return json({ ok: true, trusted, credits: credits.length, matched: r.matched.length, flagged: r.flagged.length, unmatched: r.unmatched.length });
}

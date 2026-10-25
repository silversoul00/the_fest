// Pure parsing helpers for the zero-fee bank UPI flow (no server deps, unit-testable).

export type Credit = { utr: string | null; amountPaise: number; raw: string };

/** 12 digits, and not the same digit twelve times (000000000000 is never a real UPI reference). */
export const UTR_RE = /^(?!(\d)\1{11}$)\d{12}$/;
export const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export function upiLink(vpa: string, payee: string, amountPaise: number, note: string) {
  const p = new URLSearchParams({ pa: vpa, pn: payee, am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: note });
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20');
}

/** "1,234.50" / "₹1234" / "Rs. 99.9" → paise, or null */
export function toPaise(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return Number.isFinite(s) && s > 0 ? Math.round(s * 100) : null;
  const m = s.replace(/[₹,\s]|Rs\.?|INR/gi, '').match(/^-?\d+(\.\d{1,2})?$/);
  if (!m) return null;
  const v = Math.round(parseFloat(m[0]) * 100);
  return v > 0 ? v : null;
}

const AMOUNT_RE = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i;
const UTR_IN_TEXT = /(?<!\d)(\d{12})(?!\d)/;
const CREDIT_WORDS = /\b(credited|credit(?:ed)?\s+to|received|deposited|cr\b|added to)/i;
const DEBIT_WORDS = /\b(debited|debit(?:ed)?\s+from|withdrawn|sent|paid to|dr\b)/i;

/**
 * Parse bank alert text (SMS or email). Handles several alerts pasted
 * together: splits on blank lines and on "Dear Customer"/"Your A/c" openers.
 * Only credits are returned; debits are ignored.
 */
export function parseAlerts(text: string): Credit[] {
  const chunks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n|(?=^Dear Customer)|(?=^Your (?:a\/c|account|ac\b))/im)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: Credit[] = [];
  for (const c of chunks) {
    const flat = c.replace(/\s+/g, ' ');
    if (!CREDIT_WORDS.test(flat) || (DEBIT_WORDS.test(flat) && !/credited/i.test(flat))) continue;
    const am = flat.match(AMOUNT_RE);
    const amount = am ? toPaise(am[1]) : null;
    if (!amount) continue;
    const utr = flat.match(UTR_IN_TEXT)?.[1] ?? null;
    out.push({ utr, amountPaise: amount, raw: flat.slice(0, 500) });
  }
  return out;
}

/** Minimal RFC-4180 CSV parser (quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Pull UPI credits out of a bank statement (rows from CSV or Excel).
 * Finds the header row (narration/description + credit/deposit columns),
 * then reads every row with a positive credit. Works with the usual Indian
 * bank layouts: separate Withdrawal/Deposit columns, or Amount + Dr/Cr.
 */
export function parseStatement(rows: (string | number | null)[][]): { credits: Credit[]; error?: string } {
  const norm = rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())));
  const hi = norm.findIndex((r) => {
    const s = r.join('|').toLowerCase();
    return /(narration|description|particulars|remarks|details|transaction)/.test(s) && /(credit|deposit|amount|cr\b)/.test(s);
  });
  if (hi < 0) return { credits: [], error: 'Could not find the header row. The file needs a description/narration column and a credit/deposit column.' };
  const head = norm[hi].map((h) => h.toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const descCol = find(/(narration|description|particulars|remarks|details)/);
  const refCol = find(/(ref|utr|chq|cheque)/);
  let creditCol = find(/(credit|deposit)(?!.*debit)/);
  const amountCol = find(/^(amount|txn amount|transaction amount)/);
  const drcrCol = find(/(dr\s*\/\s*cr|cr\s*\/\s*dr|^type$|debit\s*\/\s*credit)/);
  if (creditCol < 0 && amountCol < 0) return { credits: [], error: 'Could not find a credit/deposit amount column.' };

  const credits: Credit[] = [];
  for (const r of norm.slice(hi + 1)) {
    let amount: number | null = null;
    if (creditCol >= 0) amount = toPaise(r[creditCol]);
    else if (amountCol >= 0) {
      const t = (drcrCol >= 0 ? r[drcrCol] : '').toLowerCase();
      if (/^(cr|credit|c)$/.test(t)) amount = toPaise(r[amountCol]);
    }
    if (!amount) continue;
    const text = [descCol >= 0 ? r[descCol] : '', refCol >= 0 ? r[refCol] : '', r.join(' ')].join(' ');
    const utr = text.match(UTR_IN_TEXT)?.[1] ?? null;
    credits.push({ utr, amountPaise: amount, raw: r.join(' | ').slice(0, 500) });
  }
  return { credits };
}

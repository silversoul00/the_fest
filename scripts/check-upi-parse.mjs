// Sanity checks for bank alert / statement parsing (run: node scripts/check-upi-parse.mjs)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = readFileSync(new URL('../src/lib/upi-parse.ts', import.meta.url), 'utf8');
const m = await import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(src)));

// Alerts in common bank styles, pasted together (+ one debit that must be ignored)
const alerts = `Dear Customer, Rs.270.37 has been credited to your A/c XX1234 on 16-10-26 by VPA arjun@okaxis. UPI Ref No 412345678901.

ICICI Bank Acct XX567 credited with INR 1,040.12 on 16-Oct-26; UPI:498765432109. Avl Bal Rs 50,000.

Your a/c XX1234 is debited for Rs.500.00 on 16-10-26. UPI Ref 411111111111.

₹ 99.05 received in your account from priya@ybl. UTR 400000000001`;
const a = m.parseAlerts(alerts);
assert.deepEqual(a.map((c) => [c.utr, c.amountPaise]), [['412345678901', 27037], ['498765432109', 104012], ['400000000001', 9905]]);

// Statement: separate Withdrawal / Deposit columns (HDFC/ICICI style) with junk rows above header
const csv = `Account Statement,,,,,
Name: FEST COMMITTEE,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
16/10/26,UPI-ARJUN SHARMA-arjun@okaxis-412345678901-PAYMENT,0000412345678901,16/10/26,,270.37,10270.37
16/10/26,NEFT-VENDOR,N123,16/10/26,"5,000.00",,5270.37
16/10/26,"UPI/498765432109/TF ORDER/priya@ybl",,16/10/26,,"1,040.12",6310.49`;
const s = m.parseStatement(m.parseCsv(csv));
assert.equal(s.error, undefined);
assert.deepEqual(s.credits.map((c) => [c.utr, c.amountPaise]), [['412345678901', 27037], ['498765432109', 104012]]);

// Statement: Amount + Dr/Cr layout
const csv2 = `Txn Date,Description,Amount,Dr/Cr,Balance
16-10-2026,UPI/CR/412345678902/RAHUL,250.12,CR,100
16-10-2026,UPI/DR/412345678903/SHOP,100.00,DR,0`;
const s2 = m.parseStatement(m.parseCsv(csv2));
assert.deepEqual(s2.credits.map((c) => [c.utr, c.amountPaise]), [['412345678902', 25012]]);

// No header → helpful error
assert.ok(m.parseStatement([['a', 'b'], ['1', '2']]).error);

// UPI link
assert.equal(m.upiLink('fest@icici', 'Neon Utsav', 27037, 'TF 7K2M'), 'upi://pay?pa=fest%40icici&pn=Neon%20Utsav&am=270.37&cu=INR&tn=TF%207K2M');
assert.ok(m.VPA_RE.test('neonutsav.fest@icici') && !m.VPA_RE.test('bad vpa@x') && !m.VPA_RE.test('noat'));
assert.equal(m.toPaise('1,234.5'), 123450);

console.log('✓ UPI parsing checks passed');

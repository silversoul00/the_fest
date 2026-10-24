// Sanity checks for the pricing maths (run: node scripts/check-pricing.mjs)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Load the TS module without a build step (Node 22.6+ type stripping)
const src = readFileSync(new URL('../src/lib/pricing.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(src);
const mod = await import('data:text/javascript,' + encodeURIComponent(js));
const { quote, perTicketFee } = mod;

const base = { mode: 'flat', flatPaise: 2000, percent: 5, minPaise: 800, maxPaise: 3000, payer: 'student', gatewayRate: 0.0236, passGateway: true };

// Flat ₹20 on a ₹250 ticket via gateway: merchant must net exactly ₹270
let q = quote(25000, 1, base, 'gateway');
assert.equal(q.fee, 2000);
const net = q.total - Math.round(q.total * base.gatewayRate);
assert.ok(Math.abs(net - 27000) <= 1, `net after gateway ${net}`);

// Bank UPI: no gateway charge
q = quote(25000, 2, base, 'upi_direct');
assert.equal(q.gatewayFee, 0); assert.equal(q.total, 54000);

// Free tickets always free
assert.equal(quote(0, 3, base, 'gateway').total, 0);

// Percent with floor and cap
const pct = { ...base, mode: 'percent' };
assert.equal(perTicketFee(10000, pct), 800);   // 5% of ₹100 = ₹5 → floor ₹8
assert.equal(perTicketFee(40000, pct), 2000);  // 5% of ₹400
assert.equal(perTicketFee(100000, pct), 3000); // 5% of ₹1000 = ₹50 → cap ₹30

// Organizer pays: student pays ticket price (+ gateway)
q = quote(25000, 1, { ...base, payer: 'organizer', passGateway: false }, 'gateway');
assert.equal(q.total, 25000);

console.log('✓ pricing checks passed');

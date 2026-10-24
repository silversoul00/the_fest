// Test-only stand-in for Cashfree, loaded into a local `next start` with
//   NODE_OPTIONS="--import ./tests/fake_cashfree.mjs"  FAKE_CF_STATE=/path/state.json
// It answers calls to sandbox.cashfree.com / api.cashfree.com like Cashfree would, without the network:
//   • sandbox host accepts only TEST app ids, the production host only non-TEST ids (401 otherwise)
//   • POST /orders remembers the amount; GET /orders/{id} says PAID with that amount (or the amount in the state file)
// Every call is appended to state.calls so tests can see which host was asked (or that none was).
// Never used outside tests: nothing in src/ imports it.
import fs from 'node:fs';

const STATE = process.env.FAKE_CF_STATE;
const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { orders: {}, calls: [] }; } };
const write = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
globalThis.fetch = async function (input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (!STATE || !/(^|\.)cashfree\.com$/.test(url.hostname)) return realFetch(input, init);
  const s = read(); s.orders ??= {}; s.calls ??= [];
  const method = (init.method ?? 'GET').toUpperCase();
  const h = new Headers(init.headers ?? {});
  const appId = h.get('x-client-id') ?? '';
  const host = url.hostname.startsWith('sandbox') ? 'sandbox' : 'production';
  s.calls.push({ host, method, path: url.pathname });
  const keyOk = host === 'sandbox' ? appId.startsWith('TEST') : !!appId && !appId.startsWith('TEST');
  if (!keyOk) { write(s); return reply(401, { message: 'authentication Failed', code: 'request_failed' }); }
  let m;
  if (method === 'POST' && url.pathname === '/pg/orders') {
    const b = JSON.parse(init.body ?? '{}');
    s.orders[b.order_id] = { amount: b.order_amount, host };
    write(s);
    return reply(200, { order_id: b.order_id, payment_session_id: 'session_fake_' + b.order_id.slice(0, 8), order_status: 'ACTIVE' });
  }
  if ((m = url.pathname.match(/^\/pg\/orders\/([^/]+)\/payments$/))) {
    const o = s.orders[decodeURIComponent(m[1])]; write(s);
    return reply(200, o ? [{ cf_payment_id: 'fakepay' + Date.now(), payment_status: 'SUCCESS', payment_amount: o.amount }] : []);
  }
  if ((m = url.pathname.match(/^\/pg\/orders\/([^/]+)$/))) {
    const o = s.orders[decodeURIComponent(m[1])]; write(s);
    return o ? reply(200, { order_status: 'PAID', order_amount: o.amount }) : reply(404, { message: 'order not found' });
  }
  write(s);
  return reply(404, { message: 'fake cashfree: unknown path ' + url.pathname });
};

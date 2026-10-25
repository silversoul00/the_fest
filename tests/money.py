# Money safety in production mode: no path issues a PAID ticket without real money.
# Starts its own `next start` servers on :3003 with a fake Cashfree (tests/fake_cashfree.mjs, no network).
# Each refusal is paired with a development-mode control that DOES issue the ticket, so a "refused" result
# proves the production guard works, not that the test setup is broken.
#   1. Cashfree sandbox keys in production: cashfree-verify and the signed webhook issue nothing
#   2. Razorpay rzp_test_ key in production: signed webhook "ignored", checkout verify 503
#   3. CASHFREE_ENV="production " (trailing space) with sandbox keys
#   4. Real production without APP_ENV / VERCEL_ENV (NODE_ENV=production, non-local database URL)
#   5. Ticket price changes from free to paid while checkout is running (gateway off)
#   6. Production, no gateway keys: every payment route, odd quantities, double submits
import asyncio, base64, hashlib, hmac, json, os, signal, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg_tls_proxy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
PORT = 3003
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
CF_TEST = dict(CASHFREE_APP_ID='TEST1234fake', CASHFREE_SECRET_KEY='cfsk_ma_test_fakesecret', CASHFREE_ENV='sandbox')
RZ_TEST = dict(RAZORPAY_KEY_ID='rzp_test_FAKE123', RAZORPAY_KEY_SECRET='rzpsecretfake', RAZORPAY_WEBHOOK_SECRET='whsecretfake')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()

BASE_ENV = {'DEMO_PAYMENTS': '', 'E2E_ERROR_ROUTE': '', 'ADMIN_EMAILS': '', 'APP_ENV': '', 'VERCEL_ENV': '',
            'CASHFREE_APP_ID': '', 'CASHFREE_SECRET_KEY': '', 'CASHFREE_ENV': '', 'RAZORPAY_KEY_ID': '', 'RAZORPAY_KEY_SECRET': '',
            'RAZORPAY_WEBHOOK_SECRET': '', 'RESEND_API_KEY': '', 'PAYMENT_GATEWAY': ''}
STATE = os.path.join(tempfile.mkdtemp(prefix='fakecf-'), 'state.json')

class Server:
    def __init__(self, **env):
        self.base = f'http://localhost:{PORT}'
        e = os.environ.copy(); e.update(BASE_ENV); e.update(env); e['PORT'] = str(PORT)
        e['NODE_OPTIONS'] = (e.get('NODE_OPTIONS', '') + ' --import ' + os.path.join(ROOT, 'tests/fake_cashfree.mjs')).strip()
        e['FAKE_CF_STATE'] = STATE
        self.log = open(f'{E2E}/server-{PORT}.log', 'a')
        self.p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', str(PORT)], cwd=ROOT, env=e,
                                  stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            try: urllib.request.urlopen(self.base + '/legal/terms', timeout=3); return
            except urllib.error.HTTPError: return
            except Exception: time.sleep(0.5)
        raise RuntimeError('server did not start')
    def stop(self):
        try: os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        self.p.wait(15); self.log.close()

def http(base, path, data=None, headers=None):
    req = urllib.request.Request(base + path, data=data, headers=headers or {}, method='POST' if data is not None else 'GET')
    try:
        r = urllib.request.urlopen(req, timeout=20); return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def cf_state():
    try: return json.load(open(STATE))
    except Exception: return {'orders': {}, 'calls': []}
def cf_reset(): json.dump({'orders': {}, 'calls': []}, open(STATE, 'w'))

async def login(b, base, email, pw='password123'):
    pg = await (await b.new_context(**MOBILE)).new_page()
    await pg.goto(base + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def post(pg, path, data):
    return await pg.evaluate("""([p, d]) => fetch(p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d)})
        .then(async r => ({status: r.status, body: await r.json().catch(() => ({}))}))""", [path, data])

def tt(slug, name): return q(f"select tt.id from ticket_types tt join fests f on f.id=tt.fest_id where f.slug='{slug}' and tt.name='{name}'")
def order(oid): return q(f"select status || ' ' || (select count(*) from tickets where order_id = o.id) from orders o where id = '{oid}'")
def sold(tid): return q(f"select sold from ticket_types where id='{tid}'")

def cf_webhook(base, oid, secret):
    raw = json.dumps({'type': 'PAYMENT_SUCCESS_WEBHOOK', 'data': {'order': {'order_id': oid}, 'payment': {'payment_status': 'SUCCESS'}}})
    ts = str(int(time.time()))
    sig = base64.b64encode(hmac.new(secret.encode(), (ts + raw).encode(), hashlib.sha256).digest()).decode()
    return http(base, '/api/webhooks/cashfree', raw.encode(), {'Content-Type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': sig})

def rz_webhook(base, rzp_order, secret):
    raw = json.dumps({'event': 'payment.captured', 'payload': {'payment': {'entity': {'id': 'pay_fake' + rzp_order[-6:], 'order_id': rzp_order}}}})
    sig = hmac.new(secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return http(base, '/api/webhooks/razorpay', raw.encode(), {'Content-Type': 'application/json', 'x-razorpay-signature': sig})

def rz_order(email, ttid, rzp_id):
    """A pending Razorpay order as checkout would leave it (seat held)."""
    oid = q(f"insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, gateway_fee_paise, provider, method, razorpay_order_id) "
            f"select u.id, tt.fest_id, tt.id, 1, tt.price_paise + 1500, 1500, 0, 'razorpay', 'gateway', '{rzp_id}' from users u, ticket_types tt "
            f"where u.email = '{email}' and tt.id = '{ttid}' returning id").splitlines()[0]
    q(f"update ticket_types set sold = sold + 1 where id = '{ttid}'")
    return oid

async def cashfree_orders(b, srv, email, ttid, n):
    """Pending Cashfree orders made through the real checkout (against the fake Cashfree)."""
    st = await login(b, srv.base, email); ids = []
    for _ in range(n):
        r = await post(st, '/api/checkout', {'ticketTypeId': ttid, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
        ids.append(r['body'].get('orderId')); last = r
    return st, ids, last

async def main():
    os.makedirs(E2E, exist_ok=True); cf_reset()
    stamp = str(int(time.time()))
    email = f'money{stamp}@example.com'
    kalaa = tt('kalaa-fest', 'General')
    kalaa_upi = q("select upi_enabled::text || '|' || coalesce(upi_vpa,'') from fests where slug='kalaa-fest'")
    q("update fests set upi_enabled = true, upi_vpa = 'kalaafest@okaxis' where slug = 'kalaa-fest'")

    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── Control: development + Cashfree sandbox keys → a sandbox PAID issues tickets ──
        S = Server(**CF_TEST, NEXT_PUBLIC_SITE_URL='')
        try:
            pg = await (await b.new_context(**MOBILE)).new_page()
            await pg.goto(S.base + '/signup?role=student'); await pg.fill('input[name=name]', 'ಮನಿ ಟೆಸ್ಟ್ पैसा'); await pg.fill('input[name=email]', email)
            await pg.fill('input[name=password]', 'password123'); await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
            st, ids, last = await cashfree_orders(b, S, email, kalaa, 4)
            check('dev control: checkout opens Cashfree sandbox (fake)', last['status'] == 200 and last['body'].get('mode') == 'cashfree' and last['body'].get('env') == 'sandbox', last)
            ctl = ids[3]
            # double submit: popup-close verify and webhook arrive together, 3 times each
            rs = await asyncio.gather(*[post(st, '/api/checkout/cashfree-verify', {'orderId': ctl}) for _ in range(3)],
                                      *[asyncio.to_thread(cf_webhook, S.base, ctl, CF_TEST['CASHFREE_SECRET_KEY']) for _ in range(3)])
            check('dev control: sandbox PAID issues the ticket (once, despite 6 parallel confirmations)', order(ctl) == 'paid 1', (order(ctl), [r['status'] if isinstance(r, dict) else r[0] for r in rs]))
        finally:
            S.stop()
        cf_ids = ids[:3]
        q(f"update orders set created_at = now() where id in ('{cf_ids[0]}','{cf_ids[1]}','{cf_ids[2]}')")

        # ── 1. Production + Cashfree sandbox keys ──
        s0 = sold(kalaa)
        S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', **CF_TEST)
        try:
            st = await login(b, S.base, email)
            r = await post(st, '/api/checkout/cashfree-verify', {'orderId': cf_ids[0]})
            check('prod + sandbox keys: cashfree-verify on a sandbox-PAID order refuses', r['status'] != 200 or r['body'].get('paid') is not True, r)
            check('prod + sandbox keys: that order stays pending with no tickets', order(cf_ids[0]) == 'pending 0', order(cf_ids[0]))
            s, body = cf_webhook(S.base, cf_ids[1], CF_TEST['CASHFREE_SECRET_KEY'])
            check('prod + sandbox keys: signed webhook answers 200 {ok:false}', s == 200 and json.loads(body).get('ok') is False, (s, body))
            check('prod + sandbox keys: webhook order stays pending with no tickets', order(cf_ids[1]) == 'pending 0', order(cf_ids[1]))
            check('prod + sandbox keys: no seats moved', sold(kalaa) == s0, (s0, sold(kalaa)))
        finally:
            S.stop()

        # ── 2. Razorpay test key: control in development, refusal in production ──
        rz0, rz1 = f'order_fake{stamp}a', f'order_fake{stamp}b'
        o_rz0, o_rz1 = rz_order(email, kalaa, rz0), rz_order(email, kalaa, rz1)
        S = Server(**RZ_TEST)
        try:
            s, body = rz_webhook(S.base, rz0, RZ_TEST['RAZORPAY_WEBHOOK_SECRET'])
            check('dev control: signed Razorpay test webhook issues the ticket', s == 200 and order(o_rz0) == 'paid 1', (s, body, order(o_rz0)))
        finally:
            S.stop()
        S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', **RZ_TEST)
        try:
            s, body = rz_webhook(S.base, rz1, RZ_TEST['RAZORPAY_WEBHOOK_SECRET'])
            check('prod + rzp_test_: signed webhook → 200 "ignored"', s == 200 and 'ignored' in json.loads(body), (s, body))
            check('prod + rzp_test_: order stays pending, no tickets', order(o_rz1) == 'pending 0', order(o_rz1))
            st = await login(b, S.base, email)
            pay = 'pay_fake' + stamp
            sig = hmac.new(RZ_TEST['RAZORPAY_KEY_SECRET'].encode(), f'{rz1}|{pay}'.encode(), hashlib.sha256).hexdigest()
            r = await post(st, '/api/checkout/verify', {'orderId': o_rz1, 'razorpay_order_id': rz1, 'razorpay_payment_id': pay, 'razorpay_signature': sig})
            check('prod + rzp_test_: correctly signed checkout verify → 503', r['status'] == 503, r)
            check('prod + rzp_test_: still pending, no tickets', order(o_rz1) == 'pending 0', order(o_rz1))
        finally:
            S.stop()

        # ── 3. CASHFREE_ENV="production " (trailing space), sandbox keys ──
        cf_reset()
        S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', **{**CF_TEST, 'CASHFREE_ENV': 'production '})
        try:
            s, body = http(S.base, '/api/health')
            print('   health with CASHFREE_ENV="production " + sandbox keys:', s, body)
            check('CASHFREE_ENV="production " + sandbox keys: health flags it (not ok)', s == 503 and 'GATEWAY_TEST_KEYS_IN_PRODUCTION' in body, (s, body))
            st = await login(b, S.base, email)
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            calls = cf_state()['calls']
            print('   checkout:', r, ' Cashfree calls:', calls)
            oid = r['body'].get('orderId')
            if oid:
                await post(st, '/api/checkout/cashfree-verify', {'orderId': oid})
            check('CASHFREE_ENV="production " + sandbox keys: a sandbox payment issues NO ticket in production',
                  not oid or order(oid).endswith(' 0'), (r['status'], r['body'].get('env'), oid and order(oid), [c['host'] for c in cf_state()['calls']]))
        finally:
            S.stop()
        # same stray space with LIVE keys. Before fix round 1 the calls went to the sandbox host (mismatched trimming)
        # and failed. Decision 1 (2026-10-17): CASHFREE_ENV is read the same trimmed way everywhere, so health,
        # payments and the Cashfree client all agree: live keys + "production " = Cashfree production, never sandbox.
        cf_reset()
        S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', CASHFREE_APP_ID='LIVEfake99', CASHFREE_SECRET_KEY='cfsk_ma_prod_fake', CASHFREE_ENV='production ')
        try:
            s, body = http(S.base, '/api/health')
            st = await login(b, S.base, email)
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            hosts = [c['host'] for c in cf_state()['calls']]
            check('CASHFREE_ENV="production " + live keys: health, checkout and Cashfree calls all agree on production (never sandbox)',
                  'GATEWAY_TEST_KEYS' not in body and 'NO_LIVE_GATEWAY' not in body and r['body'].get('env') == 'production' and hosts and set(hosts) == {'production'},
                  (body, r, hosts))
            if r['body'].get('orderId'):
                # release the seat the way an abandoned checkout does (order failed, seat back)
                q(f"with o as (update orders set status = 'failed' where id = '{r['body']['orderId']}' and status = 'pending' returning qty) "
                  f"update ticket_types set sold = greatest(sold - (select qty from o), 0) where id = '{kalaa}' and exists (select 1 from o)")
        finally:
            S.stop()

        # ── 4. Production without APP_ENV / VERCEL_ENV (NODE_ENV=production via next start, non-local DB host) ──
        # 'vm' is this machine's own hostname; a TLS front on :6543 stands in for Supabase's pooler.
        cf_reset(); tls = pg_tls_proxy.start(6543)
        REMOTE = 'postgres://postgres@vm:6543/thefest'
        S = Server(DATABASE_URL=REMOTE, NEXT_PUBLIC_SITE_URL='https://thefest.example', **CF_TEST)
        try:
            s, body = http(S.base, '/api/health')
            print('   health, no APP_ENV/VERCEL_ENV, remote-looking DB, sandbox keys:', s, body)
            check('simulated remote database is reachable (setup)', '"db":"up"' in body, body)
            st = await login(b, S.base, email)
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            oid = r['body'].get('orderId')
            if oid: await post(st, '/api/checkout/cashfree-verify', {'orderId': oid})
            check('no APP_ENV/VERCEL_ENV + remote DB + sandbox keys: sandbox payment issues NO ticket (fail closed)',
                  not oid or order(oid).endswith(' 0'), (r['status'], r['body'].get('mode'), oid and order(oid)))
        finally:
            S.stop()
        S = Server(DATABASE_URL=REMOTE, NEXT_PUBLIC_SITE_URL='https://thefest.example', DEMO_PAYMENTS='1')
        try:
            st = await login(b, S.base, email)
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            oid = r['body'].get('orderId')
            if r['body'].get('mode') == 'demo': await post(st, '/api/checkout/demo-confirm', {'orderId': oid})
            check('no APP_ENV/VERCEL_ENV + remote DB + DEMO_PAYMENTS=1: no pretend payment (fail closed)',
                  r['body'].get('mode') != 'demo', (r['status'], r['body'].get('mode'), oid and order(oid)))
        finally:
            S.stop(); tls.close()

        # ── 5 + 6. Production, no gateway keys ──
        S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example')
        try:
            t_nokeys = q('select now()')
            st = await login(b, S.base, email)
            # 5. Free ticket type becomes paid while checkout runs. A held row lock makes the window certain:
            #    checkout's first price read sees ₹0, its locked read waits, then sees the new price.
            free = tt('hackverse', 'Hacker (team member)'); f0 = sold(free)
            price0 = q(f"select price_paise from ticket_types where id = '{free}'")
            lock = subprocess.Popen(DB.split() + ['-q'], stdin=subprocess.PIPE, text=True)
            lock.stdin.write(f"begin; update ticket_types set price_paise = 19900 where id = '{free}';\n"); lock.stdin.flush()
            await asyncio.sleep(0.5)
            task = asyncio.ensure_future(post(st, '/api/checkout', {'ticketTypeId': free, 'qty': 1, 'method': 'gateway'}))
            await asyncio.sleep(1.5)
            lock.stdin.write('commit;\n'); lock.stdin.close(); lock.wait(10)
            r = await task
            check('price 0 → paid mid-checkout (gateway off): 503', r['status'] == 503, r)
            check('price 0 → paid mid-checkout: seat released, no ticket', sold(free) == f0 and q(f"select count(*) from orders o join users u on u.id=o.user_id where u.email='{email}' and o.ticket_type_id='{free}' and o.status='paid'") == '0', (f0, sold(free)))
            q(f"update ticket_types set price_paise = {price0} where id = '{free}'")
            # Fest page loaded while free, then price changes, then the student taps the button
            q(f"update ticket_types set price_paise = 0 where id = '{free}'")
            await st.goto(S.base + '/fests/hackverse'); await st.wait_for_load_state('networkidle')
            q(f"update ticket_types set price_paise = 19900 where id = '{free}'"); f1 = sold(free)
            await st.locator('#tickets label:has-text("Hacker (team member)")').click()
            btn = st.locator('#tickets button:has-text("Get free ticket")')
            if await btn.count():
                await btn.dblclick(); await st.wait_for_timeout(1500)
            msg = await st.locator('#tickets .alert').all_text_contents()
            check('stale "free" page, now paid: no ticket, seat count unchanged, plain message', sold(free) == f1 and '/tickets' not in st.url, (msg, st.url))
            q(f"update ticket_types set price_paise = {price0} where id = '{free}'")

            # 6. Every payment route, production, no keys
            paid_before = q("select count(*) from orders where status = 'paid'"); t_before = q('select count(*) from tickets')
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            check('no keys: paid card checkout 503', r['status'] == 503, r)
            r = await post(st, '/api/checkout/demo-confirm', {'orderId': cf_ids[2]})
            check('no keys: demo-confirm 404', r['status'] == 404, r)
            r = await post(st, '/api/checkout/cashfree-verify', {'orderId': cf_ids[2]})
            check('no keys: cashfree-verify on an old Cashfree order issues nothing', r['body'].get('paid') is not True and order(cf_ids[2]) == 'pending 0', (r, order(cf_ids[2])))
            s, body = cf_webhook(S.base, cf_ids[2], CF_TEST['CASHFREE_SECRET_KEY'])
            check('no keys: Cashfree webhook refused (no secret to check against)', s == 401 and order(cf_ids[2]) == 'pending 0', (s, body))
            s, body = rz_webhook(S.base, rz1, '')
            check('no keys: Razorpay webhook with empty-secret signature refused', s == 401 and order(o_rz1) == 'pending 0', (s, body))
            r = await post(st, '/api/checkout/verify', {'orderId': o_rz1, 'razorpay_order_id': rz1, 'razorpay_payment_id': 'pay_x', 'razorpay_signature': 'x'})
            check('no keys: checkout verify 503', r['status'] == 503, r)
            # bank UPI: typing a UTR alone never issues a ticket
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'upi_direct'})
            upi = r['body'].get('orderId')
            r2 = await post(st, '/api/checkout/upi-utr', {'orderId': upi, 'utr': '612345678901'})
            r3 = await post(st, '/api/checkout/upi-utr', {'orderId': upi, 'utr': '612345678901'})
            check('no keys: bank UPI + typed UTR (twice) leaves the order unpaid, no ticket', upi and order(upi) == 'pending 0', (r['status'], r2, r3, upi and order(upi)))
            # odd quantities and ids
            for qty in [0, -1, 11, 1.5, 1e9, '2', None]:
                r = await post(st, '/api/checkout', {'ticketTypeId': free, 'qty': qty, 'method': 'gateway'})
                ok = r['status'] in (400, 409) or (qty in ('2', None) and r['status'] in (200, 400, 409))
                check(f'no keys: free checkout qty={qty!r} handled', ok, r)
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'something-else', 'phone': '9876543210'})
            check('no keys: unknown method treated as card → 503', r['status'] == 503, r)
            # logged out
            anon = await (await b.new_context()).new_page(); await anon.goto(S.base + '/legal/terms')
            r = await post(anon, '/api/checkout', {'ticketTypeId': free, 'qty': 1})
            check('logged out: checkout 401', r['status'] == 401, r)
            paid_now = q("select count(*) from orders where status = 'paid'")
            new_paid = q(f"select count(*) from orders where status = 'paid' and amount_paise > 0 and provider not in ('free') and paid_at >= '{t_nokeys}' and user_id = (select id from users where email = '{email}')")
            check('no keys: no new PAID order with money for this student in production mode', new_paid == '0', (paid_before, paid_now, new_paid))
        finally:
            S.stop()
        await b.close()

    q(f"update fests set upi_enabled = {kalaa_upi.split('|')[0]}, upi_vpa = nullif('{kalaa_upi.split('|')[1]}', '') where slug = 'kalaa-fest'")
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} money-safety checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

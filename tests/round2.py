# Tester round 2 (2026-10-17): the supervisor's round-2 test plan, by hand-style checks on DATABASE COPIES.
# Own servers on :3006 (fake Cashfree loaded, no network). Local Postgres only; the release-check database is
# copied (tfr2_*) and never changed.
#   A. Production detection / money (plan 1–6): test keys with "production ", test secret only, real preview with
#      sandbox keys on a remote-looking DB, unreachable DB, VERCEL_ENV=" PRODUCTION ", CASHFREE_ENV="Production",
#      live-looking keys + CASHFREE_ENV=sandbox
#   B. Login throttle (plan 7–10): 40 and 200 parallel bursts on /login and /scan/login, 60 rotating networks,
#      right password from another network, missing login_attempts
#   C. Admin "Unlock a login": non-admin / logged-out replays of the action, odd emails, double click, two tabs
#   D. Schema check / health (plan 11–14) and error log (plan 15–16)
#   E. /setup/keys with and without keys (plan 17), screenshots at 390 and 1280 (plan 18)
import asyncio, base64, hashlib, hmac, json, os, re, signal, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg_tls_proxy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
SHOTS = os.environ.get('SHOTS', f'{E2E}/round2')
PORT = 3006
BASE = f'http://localhost:{PORT}'
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
DESKTOP = dict(viewport={'width': 1280, 'height': 900})
CF_TEST = dict(CASHFREE_APP_ID='TEST1234fake', CASHFREE_SECRET_KEY='cfsk_ma_test_fakesecret', CASHFREE_ENV='sandbox')
CF_LIVE = dict(CASHFREE_APP_ID='LIVEfake99', CASHFREE_SECRET_KEY='cfsk_ma_prod_fake')
PROD = dict(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example')
results, notes = [], []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:400]}]' if extra != '' else ''), flush=True)
def note(s): notes.append(s); print('   NOTE ' + s, flush=True)
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)
def psql(db): return f'psql -h /tmp -U postgres {db}'
def q(sql, db='tfr2_a'): return subprocess.run(psql(db) + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def url(db): return f'postgres://postgres@localhost:5432/{db}'

def copy_db(name):
    r = sh(f'dropdb -h /tmp -U postgres --if-exists {name} && createdb -h /tmp -U postgres {name} && '
           f'pg_dump -h /tmp -U postgres thefest | psql -q -h /tmp -U postgres {name} >/dev/null 2>&1')
    assert q('select count(*) from users', name) not in ('', '0'), f'copy {name} failed: {r.stderr}'
def drop_db(name): sh(f'dropdb -h /tmp -U postgres --if-exists {name}')

BASE_ENV = {'DEMO_PAYMENTS': '', 'E2E_ERROR_ROUTE': '', 'ADMIN_EMAILS': '', 'APP_ENV': '', 'VERCEL_ENV': '', 'NEXT_PUBLIC_SITE_URL': '',
            'CASHFREE_APP_ID': '', 'CASHFREE_SECRET_KEY': '', 'CASHFREE_ENV': '', 'RAZORPAY_KEY_ID': '', 'RAZORPAY_KEY_SECRET': '',
            'RAZORPAY_WEBHOOK_SECRET': '', 'RESEND_API_KEY': '', 'PAYMENT_GATEWAY': ''}
STATE = os.path.join(tempfile.mkdtemp(prefix='fakecf-r2-'), 'state.json')
def cf_state():
    try: return json.load(open(STATE))
    except Exception: return {'orders': {}, 'calls': []}
def cf_reset(): json.dump({'orders': {}, 'calls': []}, open(STATE, 'w'))

class Server:
    def __init__(self, db='tfr2_a', **env):
        e = os.environ.copy(); e.update(BASE_ENV); e['DATABASE_URL'] = db if '://' in db else url(db); e.update(env); e['PORT'] = str(PORT)
        e['NODE_OPTIONS'] = (e.get('NODE_OPTIONS', '') + ' --import ' + os.path.join(ROOT, 'tests/fake_cashfree.mjs')).strip()
        e['FAKE_CF_STATE'] = STATE
        self.log = open(f'{E2E}/server-{PORT}.log', 'a')
        self.p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', str(PORT)], cwd=ROOT, env=e,
                                  stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            try: urllib.request.urlopen(BASE + '/legal/terms', timeout=3); return
            except urllib.error.HTTPError: return
            except Exception: time.sleep(0.5)
        raise RuntimeError('server did not start')
    def stop(self):
        try: os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        self.p.wait(15); self.log.close()

def http(path, data=None, headers=None, method=None):
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {}, method=method or ('POST' if data is not None else 'GET'))
    try:
        r = urllib.request.urlopen(req, timeout=60); return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def health():
    s, body = http('/api/health')
    try: j = json.loads(body)
    except Exception: j = {}
    return s, j, body

async def login(b, email, path='/login', pw='password123', ip=None, opts=MOBILE):
    o = dict(opts)
    if ip: o['extra_http_headers'] = {'x-forwarded-for': f'{ip}, 10.0.0.1'}
    pg = await (await b.new_context(**o)).new_page()
    await pg.goto(BASE + path); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)
    return pg

async def alert_text(pg):
    a = pg.locator('.alert')
    return ' '.join(await a.all_text_contents()) if await a.count() else ''

async def post(pg, path, data):
    return await pg.evaluate("""([p, d]) => fetch(p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d)})
        .then(async r => ({status: r.status, body: await r.json().catch(() => ({}))}))""", [path, data])

def cf_webhook(oid, secret):
    raw = json.dumps({'type': 'PAYMENT_SUCCESS_WEBHOOK', 'data': {'order': {'order_id': oid}, 'payment': {'payment_status': 'SUCCESS'}}})
    ts = str(int(time.time()))
    sig = base64.b64encode(hmac.new(secret.encode(), (ts + raw).encode(), hashlib.sha256).digest()).decode()
    return http('/api/webhooks/cashfree', raw.encode(), {'Content-Type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': sig})

def tt(slug, name, db='tfr2_a'): return q(f"select tt.id from ticket_types tt join fests f on f.id=tt.fest_id where f.slug='{slug}' and tt.name='{name}'", db)
def order(oid, db='tfr2_a'): return q(f"select status || ' ' || (select count(*) from tickets where order_id = o.id) from orders o where id = '{oid}'", db)
def sold(tid, db='tfr2_a'): return q(f"select sold from ticket_types where id='{tid}'", db)
def counts(email, db='tfr2_a'): return q(f"select string_agg(key || '=' || fails, ',' order by key) from login_attempts where key like '%{email}%'", db)

async def capture_action(b, path, email, pw):
    """Submit a login form once in a real browser; return the server-action request so it can be replayed."""
    cap = {}
    ctx = await b.new_context(**MOBILE); pg = await ctx.new_page()
    def on_req(r):
        if r.method == 'POST' and 'next-action' in {k.lower() for k in r.headers}: cap['h'] = r.headers; cap['d'] = r.post_data_buffer
    pg.on('request', on_req)
    await pg.goto(BASE + path); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)
    await ctx.close()
    h = {k: v for k, v in cap['h'].items() if k.lower() in ('next-action', 'content-type', 'accept', 'next-router-state-tree')}
    h['Origin'] = BASE
    return path, h, cap['d']

def fire(req, ip=None, cookie=None):
    path, h, data = req
    hh = dict(h)
    if ip: hh['x-forwarded-for'] = ip
    if cookie: hh['Cookie'] = cookie
    try: return urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=hh, method='POST'), timeout=120).read().decode()
    except urllib.error.HTTPError as e: return f'HTTP {e.code} ' + e.read().decode()[-200:]
    except Exception as e: return 'ERR ' + str(e)

def burst(req, n, ips=None):
    res = [None] * n
    def go(i): res[i] = fire(req, ips[i] if ips else None)
    ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    [t.start() for t in ts]; [t.join() for t in ts]
    return sum('Wrong email or password' in r for r in res), sum('Too many attempts' in r for r in res), res

# On an emulated phone the layout viewport GROWS to fit too-wide content (innerWidth goes up with it), so compare with
# the device's own width, not innerWidth.
async def no_sideways(pg): return await pg.evaluate('document.documentElement.scrollWidth <= Math.min(window.innerWidth, screen.width) + 1')

async def shoot(b, path, name, cookies=None, sel=None, full=True):
    """Screenshot `path` at 390 and 1280; return {width: fits-without-sideways-scroll}."""
    out = {}
    for w, opts in (('390', MOBILE), ('1280', DESKTOP)):
        ctx = await b.new_context(**opts)
        if cookies: await ctx.add_cookies(cookies)
        pg = await ctx.new_page(); await pg.goto(BASE + path); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)
        if sel and await pg.locator(sel).count(): await pg.locator(sel).first.screenshot(path=f'{SHOTS}/{name}_{w}.png')
        else: await pg.screenshot(path=f'{SHOTS}/{name}_{w}.png', full_page=full)
        out[w] = await no_sideways(pg)
        await ctx.close()
    return out

async def admin_cookies(b):
    pg = await login(b, 'admin@thefest.in')
    c = await pg.context.cookies(); await pg.context.close(); return c

async def main():
    os.makedirs(SHOTS, exist_ok=True); cf_reset()
    copy_db('tfr2_a')
    stamp = str(int(time.time())); email = f'r2money{stamp}@example.com'
    kalaa = tt('kalaa-fest', 'General')
    async with async_playwright() as p:
        b = await p.chromium.launch()
        try:
            await section_money(b, email, kalaa)
            await section_throttle(b)
            await section_unlock(b)
            await section_schema(b)
            await section_errors(b)
            await section_keys(b)
        finally:
            await b.close()
            for d in ('tfr2_a', 'tfr2_nolog', 'tfr2_noerr', 'tfr2_noev', 'tfr2_v21', 'tfr2_r1'): drop_db(d)
    print('\n' + '\n'.join('NOTE ' + n for n in notes))
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} round-2 checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

# ───────────────────────── A. production detection / money ─────────────────────────
async def section_money(b, email, kalaa):
    # Control: development + sandbox keys → pending Cashfree orders that the fake Cashfree reports PAID
    S = Server(**CF_TEST)
    try:
        pg = await (await b.new_context(**MOBILE)).new_page()
        await pg.goto(BASE + '/signup?role=student'); await pg.fill('input[name=name]', 'ರೌಂಡ್ ಎರಡು राउंड'); await pg.fill('input[name=email]', email)
        await pg.fill('input[name=password]', 'password123'); await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
        st = await login(b, email); ids = []
        for _ in range(4):
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'}); ids.append(r['body'].get('orderId'))
        check('setup: 4 sandbox Cashfree orders made in development', all(ids) and r['body'].get('env') == 'sandbox', r)
    finally:
        S.stop()

    # 1a. APP_ENV=production, TEST app id, CASHFREE_ENV="production "
    S = Server(**PROD, CASHFREE_APP_ID='TEST1234fake', CASHFREE_SECRET_KEY='cfsk_ma_test_fakesecret', CASHFREE_ENV='production ')
    try:
        s, j, body = health()
        check('1a TEST app id + CASHFREE_ENV="production ": health 503 GATEWAY_TEST_KEYS_IN_PRODUCTION', s == 503 and 'GATEWAY_TEST_KEYS_IN_PRODUCTION' in j.get('problems', []), body)
        st = await login(b, email); s0 = sold(kalaa)
        r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
        check('1a: new card checkout refused, no seat held', r['status'] != 200 and sold(kalaa) == s0, (r, s0, sold(kalaa)))
        r = await post(st, '/api/checkout/cashfree-verify', {'orderId': ids[0]})
        s2, b2 = cf_webhook(ids[1], 'cfsk_ma_test_fakesecret')
        check('1a: fake PAID via verify and signed webhook → no ticket', order(ids[0]) == 'pending 0' and order(ids[1]) == 'pending 0', (r, s2, b2, order(ids[0]), order(ids[1])))
    finally:
        S.stop()
    # 1b. live-looking app id, only the secret is a test key
    cf_reset()
    S = Server(**PROD, CASHFREE_APP_ID='12345live', CASHFREE_SECRET_KEY='cfsk_ma_test_x', CASHFREE_ENV='production')
    try:
        s, j, body = health()
        check('1b live app id + _test_ secret: health 503 GATEWAY_TEST_KEYS_IN_PRODUCTION', s == 503 and 'GATEWAY_TEST_KEYS_IN_PRODUCTION' in j.get('problems', []), body)
        st = await login(b, email)
        r = await post(st, '/api/checkout/cashfree-verify', {'orderId': ids[2]})
        s2, b2 = cf_webhook(ids[3], 'cfsk_ma_test_x')
        check('1b: verify + signed webhook (fake Cashfree would say PAID) → no ticket', order(ids[2]) == 'pending 0' and order(ids[3]) == 'pending 0',
              (r, s2, b2, order(ids[2]), order(ids[3]), cf_state()['calls']))
    finally:
        S.stop()

    # 2. VERCEL_ENV=preview + sandbox keys + remote-looking DB
    cf_reset(); tls = pg_tls_proxy.start(6543)
    try:
        S = Server(db='postgres://postgres@vm:6543/tfr2_a', VERCEL_ENV='preview', VERCEL_BRANCH_URL='thefest-git-full-app.vercel.app', **CF_TEST)
        try:
            s, j, body = health()
            prod_only = [x for x in j.get('problems', []) if x in ('RESEND_API_KEY', 'ADMIN_EMAILS', 'NEXT_PUBLIC_SITE_URL', 'GATEWAY_TEST_KEYS_IN_PRODUCTION', 'DEMO_PAYMENTS_IN_PRODUCTION', 'CASHFREE_ENV')]
            check('2 preview + sandbox + remote DB: db up, no production-only problems', j.get('db') == 'up' and not prod_only, body)
            st = await login(b, email)
            r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            oid = r['body'].get('orderId')
            v = oid and await post(st, '/api/checkout/cashfree-verify', {'orderId': oid})
            check('2 preview: sandbox checkout completes and issues the ticket', r['body'].get('env') == 'sandbox' and oid and order(oid) == 'paid 1', (r, v, oid and order(oid)))
            adm = await login(b, 'admin@thefest.in'); await adm.goto(BASE + '/admin')
            card = await adm.locator('section[aria-label=System]').inner_text()
            check('2 preview: System card says Environment preview', re.search(r'Environment\s*preview', card) is not None, card)
            await adm.locator('section[aria-label=System]').screenshot(path=f'{SHOTS}/system_preview_390.png')
        finally:
            S.stop()
    finally:
        tls.close()

    # 3. next start, DATABASE_URL to an unreachable remote host, no VERCEL_ENV
    S = Server(db='postgres://postgres:pw@db.nowhere.invalid:6543/postgres', E2E_ERROR_ROUTE='1')
    try:
        t0 = time.time(); s, j, body = health(); dt = time.time() - t0
        check('3 unreachable DB: health 503 status down, db down', s == 503 and j.get('status') == 'down' and j.get('db') == 'down', (s, body))
        check('3 unreachable DB: health body carries no host or password', 'nowhere' not in body and ':pw@' not in body, body)
        s2, b2 = http('/api/test-error')
        check('3 unreachable DB + no VERCEL_ENV: treated as production (test-only route is a 404)', s2 == 404, (s2, b2[:120]))
        note(f'plan 3: health answered in {dt:.1f}s: {s} {body}; production-only problems listed: {j.get("problems")}')
        sa, ba = http('/admin'); sl, bl = http('/login')
        note(f'plan 3: /admin → {sa}, /login → {sl} with the database unreachable')
        for path, name in (('/api/health', 'health_down'), ('/login', 'login_db_down')):
            await shoot(b, path, name)
    finally:
        S.stop()

    # 4. VERCEL_ENV=" PRODUCTION " with the local DB
    S = Server(VERCEL_ENV=' PRODUCTION ', E2E_ERROR_ROUTE='1')
    try:
        s, j, body = health(); s2, _ = http('/api/test-error')
        check('4 VERCEL_ENV=" PRODUCTION " + local DB: production (production-only problems listed, test route 404)',
              'RESEND_API_KEY' in j.get('problems', []) and s2 == 404, (body, s2))
    finally:
        S.stop()

    # 5. live keys + CASHFREE_ENV="Production"
    cf_reset()
    S = Server(**PROD, **CF_LIVE, CASHFREE_ENV='Production')
    try:
        s, j, body = health()
        check('5 live keys + CASHFREE_ENV="Production": no CASHFREE_ENV / test-key / NO_LIVE_GATEWAY problem',
              not any(x in body for x in ('"CASHFREE_ENV"', 'GATEWAY_TEST_KEYS', 'NO_LIVE_GATEWAY')), body)
        st = await login(b, email)
        r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
        oid = r['body'].get('orderId')
        if oid: await post(st, '/api/checkout/cashfree-verify', {'orderId': oid})
        hosts = [c['host'] for c in cf_state()['calls']]
        check('5: checkout env production, every Cashfree call to the production host, live PAID issues the ticket',
              r['body'].get('env') == 'production' and hosts and set(hosts) == {'production'} and oid and order(oid) == 'paid 1', (r, hosts, oid and order(oid)))
    finally:
        S.stop()

    # 6. live-looking keys + CASHFREE_ENV=sandbox in production
    cf_reset()
    S = Server(**PROD, **CF_LIVE, CASHFREE_ENV='sandbox')
    try:
        s, j, body = health()
        check('6 live keys + CASHFREE_ENV=sandbox in production: 503 naming CASHFREE_ENV', s == 503 and 'CASHFREE_ENV' in j.get('problems', []), body)
        st = await login(b, email); s0 = sold(kalaa)
        before = q(f"select count(*) from orders o join users u on u.id=o.user_id where u.email='{email}'")
        r = await post(st, '/api/checkout', {'ticketTypeId': kalaa, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
        held = str(int(q(f"select count(*) from orders o join users u on u.id=o.user_id where u.email='{email}'")) - int(before))
        check('6: checkout fails safely (not 200), seat released, nothing sent to Cashfree sandbox',
              r['status'] != 200 and sold(kalaa) == s0 and held == '0' and 'sandbox' not in [c['host'] for c in cf_state()['calls']],
              (r, s0, sold(kalaa), held, before, cf_state()['calls']))
    finally:
        S.stop()

# ───────────────────────── B. login throttle ─────────────────────────
async def section_throttle(b):
    S = Server()
    try:
        # 7. parallel bursts of 40 and 200, app and scanner login
        for path, who in (('/login', 'sponsor@thefest.in'), ('/scan/login', 'volunteer@thefest.in')):
            for n in (40, 200):
                q(f"delete from login_attempts where key like '%{who}%'")
                req = await capture_action(b, path, who, 'wrong-0')   # attempt 1
                wrong, many, res = burst(req, n)
                other = [r[-160:] for r in res if 'Wrong' not in r and 'Too many' not in r]
                check(f'7 {path}: {n} parallel wrong passwords → at most 10 reach the password check, the rest "Too many attempts"',
                      wrong + 1 <= 10 and wrong + many == n, (wrong + 1, many, other[:2], counts(who)))
            q(f"delete from login_attempts where key like '%{who}%'")

        # 8. 60 sequential wrong posts, each from a new network
        who = 'volunteer@thefest.in'
        req = await capture_action(b, '/scan/login', who, 'wrong-0'); q(f"delete from login_attempts where key like '%{who}%'")
        outs = [fire(req, f'198.51.100.{i + 1}, 10.0.0.1') for i in range(60)]
        wrong = sum('Wrong email or password' in r for r in outs); acct = sum('on this account' in r for r in outs)
        first_block = next((i + 1 for i, r in enumerate(outs) if 'Too many' in r), None)
        check('8 60 wrong passwords from 60 networks: 50 checked, then "on this account" from attempt 51', wrong == 50 and acct == 10 and first_block == 51, (wrong, acct, first_block))
        pg = await login(b, who, '/scan/login', ip='192.0.2.250')
        msg = await alert_text(pg)
        check('8 a never-seen network with the RIGHT password is also refused (cap is per email)', 'on this account' in msg and not pg.url.rstrip('/').endswith('/scan'), (pg.url, msg))
        await pg.screenshot(path=f'{SHOTS}/scan_login_account_locked_390.png')
        q(f"delete from login_attempts where key like '%{who}%'")

        # 9. 10 wrong from A, right password from B
        A, B = '203.0.113.9', '198.51.100.99'
        req = await capture_action(b, '/login', 'sponsor@thefest.in', 'wrong-0'); q("delete from login_attempts where key like '%sponsor@thefest.in%'")
        outs = [fire(req, f'{A}, 10.0.0.1') for _ in range(10)]
        eleventh = fire(req, f'{A}, 10.0.0.1')
        check('9 10 wrong from network A, the 11th from A is blocked with the network message', all('Wrong' in r for r in outs) and 'switch to mobile data' in eleventh, eleventh[-200:])
        pg = await login(b, 'sponsor@thefest.in', ip=B)
        c = counts('sponsor@thefest.in')
        check('9 right password from network B logs in', pg.url.endswith('/sponsor'), (pg.url, await alert_text(pg)))
        check('9 …and clears the e: and ip:…|B counts', 'e:sponsor' not in (c or '') and f'|{B}' not in (c or ''), c)
        check('9 network A stays blocked (its own count kept)', f'ip:sponsor@thefest.in|{A}=11' in (c or ''), c)
        pg = await login(b, 'sponsor@thefest.in', ip=A)
        msg = await alert_text(pg)
        note(f'plan 9: right password from network A after the owner logged in from B → "{msg}" (A stays blocked until its 15 minutes end)')
        q("delete from login_attempts where key like '%sponsor@thefest.in%'")
    finally:
        S.stop()

    # 10. missing login_attempts
    copy_db('tfr2_nolog'); q('drop table login_attempts', 'tfr2_nolog')
    S = Server(db='tfr2_nolog')
    try:
        t0 = q('select now()', 'tfr2_nolog')
        req = await capture_action(b, '/login', 'sponsor@thefest.in', 'wrong-0')
        outs = [fire(req) for _ in range(29)]
        check('10 no login_attempts: 30 wrong posts each say "Wrong email or password"', all('Wrong email or password' in r for r in outs), [r[-120:] for r in outs if 'Wrong' not in r][:2])
        await asyncio.sleep(1)
        row = q(f"select count(*) || ' ' || coalesce(sum(repeats), 0) from app_errors where at >= '{t0}' and where_ like 'login throttle%'", 'tfr2_nolog').split()
        check('10 …logged as ONE app_errors row counted ≥ 30 times', row[0] == '1' and int(row[1]) >= 30, row)
        s, j, body = health()
        check('10 …and health 503 names login_attempts', s == 503 and 'database setup incomplete: login_attempts' in j.get('problems', []), body)
        # admin unlock while the table is missing
        adm = await login(b, 'admin@thefest.in')
        await adm.goto(BASE + '/admin'); box = adm.locator('section[aria-label="Unlock a login"]')
        await box.locator('input[name=email]').fill('volunteer@thefest.in'); await box.locator('button[type=submit]').click()
        await adm.wait_for_timeout(1500); txt = await box.inner_text()
        check('10 admin unlock with the table missing: plain "Couldn’t unlock right now" message, page still works', 'Couldn’t unlock right now' in txt, txt)
        await box.screenshot(path=f'{SHOTS}/unlock_table_missing_390.png')
    finally:
        S.stop()

# ───────────────────────── C. admin "Unlock a login" ─────────────────────────
async def section_unlock(b):
    S = Server()
    try:
        LOCK = "insert into login_attempts (key, fails, window_start) values ('e:volunteer@thefest.in', 50, now()), ('ip:volunteer@thefest.in|203.0.113.5', 11, now()) on conflict (key) do update set fails = excluded.fails, window_start = now()"
        q(LOCK)
        # capture the unlock action as admin (for an unrelated email so nothing changes)
        adm = await login(b, 'admin@thefest.in'); cap = {}
        adm.on('request', lambda r: cap.update(h=r.headers, d=r.post_data_buffer) if r.method == 'POST' and 'next-action' in {k.lower() for k in r.headers} else None)
        await adm.goto(BASE + '/admin'); box = adm.locator('section[aria-label="Unlock a login"]')
        await box.locator('input[name=email]').fill('nobody-r2@example.com'); await box.locator('button[type=submit]').click(); await adm.wait_for_timeout(1500)
        h = {k: v for k, v in cap['h'].items() if k.lower() in ('next-action', 'content-type', 'accept', 'next-router-state-tree')}; h['Origin'] = BASE
        data = cap['d'].replace(b'nobody-r2@example.com', b'volunteer@thefest.in')
        for who in ('organizer@thefest.in', 'student@thefest.in', 'volunteer@thefest.in', None):
            cookie = None
            if who:
                q("delete from login_attempts where key like '%volunteer@thefest.in%'")
                pg = await login(b, who, '/scan/login' if who.startswith('volunteer') else '/login', ip='192.0.2.1')
                cookie = '; '.join(f"{c['name']}={c['value']}" for c in await pg.context.cookies())
                q(LOCK)
            out = fire(('/admin', h, data), cookie=cookie)
            check(f'unlock action replayed as {who or "logged-out visitor"}: nothing unlocked', counts('volunteer@thefest.in') == 'e:volunteer@thefest.in=50,ip:volunteer@thefest.in|203.0.113.5=11',
                  (counts('volunteer@thefest.in'), out[-150:]))
        # GET of /admin for non-admins shows no unlock card
        for who in ('organizer@thefest.in', 'student@thefest.in', 'sponsor@thefest.in'):
            pg = await login(b, who); await pg.goto(BASE + '/admin'); await pg.wait_for_load_state('networkidle')
            check(f'{who} opening /admin: redirected, no Unlock card', '/admin' not in pg.url and await pg.locator('section[aria-label="Unlock a login"]').count() == 0, pg.url)
        pg = await (await b.new_context(**MOBILE)).new_page(); await pg.goto(BASE + '/admin')
        check('logged out opening /admin → login page', '/login' in pg.url, pg.url)

        async def unlock(page, value, typ='text'):
            # fresh page each time (no old message), browser validation off so the SERVER's answer is tested
            await page.goto(BASE + '/admin'); bx = page.locator('section[aria-label="Unlock a login"]')
            await bx.locator('form').evaluate('(f) => { f.noValidate = true; }')
            if typ != 'email': await bx.locator('input[name=email]').evaluate('(e) => e.removeAttribute("required")')
            await bx.locator('input[name=email]').fill(value); await bx.locator('button[type=submit]').click()
            await bx.locator('.alert').wait_for(timeout=15000)
            return await bx.inner_text()
        # odd emails
        q(LOCK); t = await unlock(adm, '   VOLUNTEER@THEFEST.IN   ')
        check('unlock "   VOLUNTEER@THEFEST.IN   " → Unlocked volunteer@thefest.in, all counts gone', 'Unlocked volunteer@thefest.in' in t and counts('volunteer@thefest.in') == '', (t, counts('volunteer@thefest.in')))
        q(LOCK); t = await unlock(adm, '%@thefest.in')
        check('unlock "%@thefest.in" (SQL wildcard) unlocks nobody else', 'wasn’t locked out' in t and counts('volunteer@thefest.in') != '', (t, counts('volunteer@thefest.in')))
        t = await unlock(adm, '_olunteer@thefest.in')
        check('unlock "_olunteer@thefest.in" unlocks nobody else', counts('volunteer@thefest.in') != '', (t, counts('volunteer@thefest.in')))
        t = await unlock(adm, 'volunteer@thefest.in|203.0.113.5')
        check('unlock "volunteer@thefest.in|203.0.113.5" (key-shaped) does not remove the per-email lock', 'e:volunteer@thefest.in=50' in (counts('volunteer@thefest.in') or ''), (t, counts('volunteer@thefest.in')))
        t = await unlock(adm, 'not-an-email')
        check('unlock "not-an-email" → "Enter the email that is locked out."', 'Enter the email that is locked out' in t, t)
        t = await unlock(adm, '')
        check('unlock empty → "Enter the email that is locked out."', 'Enter the email that is locked out' in t, t)
        q("insert into login_attempts (key, fails, window_start) values ('e:ಕನ್ನಡ.हिंदी@thefest.in', 50, now()), ('ip:ಕನ್ನಡ.हिंदी@thefest.in|1.2.3.4', 11, now()) on conflict (key) do nothing")
        t = await unlock(adm, 'ಕನ್ನಡ.हिंदी@thefest.in')
        check('unlock a Kannada/Hindi email clears both its counts', 'Unlocked' in t and q("select count(*) from login_attempts where key like '%ಕನ್ನಡ%'") == '0', t)
        long = 'harshith.ds.gatevolunteer2026@christuniversity.in'   # 49 characters, a realistic college address
        t = await unlock(adm, long)
        check('390px: unlock answer for a 49-character email stays inside its box (no sideways scroll)', ('wasn’t locked out' in t or 'Unlocked' in t) and await no_sideways(adm), t[-120:])
        await adm.locator('section[aria-label="Unlock a login"]').scroll_into_view_if_needed(); await adm.screenshot(path=f'{SHOTS}/unlock_longemail_390.png')
        # double click and two tabs
        q(LOCK)
        await adm.goto(BASE + '/admin'); bx = adm.locator('section[aria-label="Unlock a login"]')
        await bx.locator('input[name=email]').fill('volunteer@thefest.in'); await bx.locator('button[type=submit]').dblclick(); await adm.wait_for_timeout(2000)
        t = await bx.inner_text()
        check('double-click Unlock: unlocked, one message, no error', counts('volunteer@thefest.in') == '' and t.count('Unlocked') + t.count('wasn’t') == 1 and 'Couldn' not in t, t)
        q(LOCK)
        adm2 = await adm.context.new_page(); await adm2.goto(BASE + '/admin')
        b1, b2 = adm.locator('section[aria-label="Unlock a login"]'), adm2.locator('section[aria-label="Unlock a login"]')
        await b1.locator('input[name=email]').fill('volunteer@thefest.in'); await b2.locator('input[name=email]').fill('volunteer@thefest.in')
        await asyncio.gather(b1.locator('button[type=submit]').click(), b2.locator('button[type=submit]').click()); await adm.wait_for_timeout(2000)
        t1, t2 = await b1.inner_text(), await b2.inner_text()
        check('two admin tabs unlock the same email at once: both answer plainly, counts gone', counts('volunteer@thefest.in') == '' and all(('Unlocked' in x or 'wasn’t' in x) for x in (t1, t2)), (t1[-80:], t2[-80:]))
        # after unlock the volunteer gets in from the very network that was blocked
        q(LOCK); await unlock(adm, 'volunteer@thefest.in', 'email')
        pg = await login(b, 'volunteer@thefest.in', '/scan/login', ip='203.0.113.5')
        check('after unlock the volunteer opens the scanner from the network that was blocked', pg.url.rstrip('/').endswith('/scan'), (pg.url, await alert_text(pg)))
        # admin's own account can be locked by the per-email cap (recorded)
        req = await capture_action(b, '/login', 'admin@thefest.in', 'wrong-0'); q("delete from login_attempts where key like '%admin@thefest.in%'")
        burst(req, 60, [f'198.18.0.{i + 1}' for i in range(60)])
        pg = await login(b, 'admin@thefest.in', ip='192.0.2.33')
        note(f'admin self-lock: after 60 wrong passwords from 60 networks the admin login says "{await alert_text(pg)}" — '
             'the admin then cannot reach "Unlock a login" for anyone (including themselves) until the 15 minutes pass')
        q("delete from login_attempts where key like '%admin@thefest.in%'")
        # Unlock card screenshots
        adm = await login(b, 'admin@thefest.in')
        cookies = await adm.context.cookies()
        for w, opts in (('390', MOBILE), ('1280', DESKTOP)):
            ctx = await b.new_context(**opts); await ctx.add_cookies(cookies); pg = await ctx.new_page()
            await pg.goto(BASE + '/admin'); q(LOCK)
            bx = pg.locator('section[aria-label="Unlock a login"]')
            await bx.screenshot(path=f'{SHOTS}/unlock_empty_{w}.png')
            await bx.locator('input[name=email]').fill('volunteer@thefest.in'); await bx.locator('button[type=submit]').click(); await pg.wait_for_timeout(1500)
            await bx.screenshot(path=f'{SHOTS}/unlock_done_{w}.png')
            await bx.locator('input[name=email]').fill('volunteer@thefest.in'); await bx.locator('button[type=submit]').click(); await pg.wait_for_timeout(1500)
            await bx.screenshot(path=f'{SHOTS}/unlock_notlocked_{w}.png')
            check(f'/admin with the Unlock card fits {w}px (no sideways scroll)', await no_sideways(pg))
            await pg.screenshot(path=f'{SHOTS}/admin_full_{w}.png', full_page=True)
            await ctx.close()
    finally:
        S.stop()
        q("delete from login_attempts where key like '%volunteer@thefest.in%'")

# ───────────────────────── D. schema check / health ─────────────────────────
async def section_schema(b):
    # 11. users.email_verified_at missing
    copy_db('tfr2_noev'); q('alter table users drop column email_verified_at cascade', 'tfr2_noev')
    S = Server(db='tfr2_noev')
    try:
        s, j, body = health()
        check('11 users.email_verified_at dropped: health 503 names users.email_verified_at', s == 503 and 'users.email_verified_at' in body, body)
    finally:
        S.stop()
    drop_db('tfr2_noev')
    # 12. app_errors missing
    copy_db('tfr2_noerr'); q('drop table app_errors', 'tfr2_noerr')
    S = Server(db='tfr2_noerr')
    try:
        s, j, body = health()
        check('12 app_errors dropped: health 503 names app_errors', s == 503 and 'database setup incomplete: app_errors' in j.get('problems', []), body)
        adm = await login(b, 'admin@thefest.in'); await adm.goto(BASE + '/admin'); await adm.wait_for_load_state('networkidle')
        card = await adm.locator('section[aria-label=System]').inner_text() if await adm.locator('section[aria-label=System]').count() else ''
        check('12 /admin still loads; System card says "setup incomplete" with the Part 2a hint', 'setup incomplete' in card and 'Part 2a' in card, card or (await adm.content())[:300])
        await adm.goto(BASE + '/admin/errors'); await adm.wait_for_load_state('networkidle')
        txt = (await adm.locator('main').inner_text()) if await adm.locator('main').count() else ''
        check('12 /admin/errors with app_errors missing: a plain "run Part 2a" message, not the crash page',
              'Something went wrong' not in txt and 'SOMETHING WENT WRONG' not in txt and 'Errors' in txt and 'Part 2a' in txt, txt[:160])
        await shoot(b, '/admin', 'system_setup_incomplete', await adm.context.cookies(), 'section[aria-label=System]')
        await shoot(b, '/admin/errors', 'errors_table_missing', await adm.context.cookies())
        await shoot(b, '/api/health', 'health_setup_incomplete')
    finally:
        S.stop()
    drop_db('tfr2_noerr')

    # 13. Part 2a on v2.1 and on a round-1 database, twice each
    sqlf = f'{E2E}/part2a-r2.sql'
    sh(f"awk '/^\\*\\*2a\\./{{f=1}} f&&/^```sql/{{g=1;next}} g&&/^```/{{exit}} g' {ROOT}/docs/LAUNCH-CHECKLIST.md > {sqlf}")
    for db, rev in (('tfr2_v21', 'abc3924'), ('tfr2_r1', 'bea0a53')):
        drop_db(db); sh(f'createdb -h /tmp -U postgres {db}')
        sh(f'cd {ROOT} && git show {rev}:db/schema.sql > {E2E}/schema-{rev}.sql')
        r0 = sh(f'{psql(db)} -v ON_ERROR_STOP=1 -q -f {E2E}/schema-{rev}.sql')
        if db == 'tfr2_r1':
            q("insert into app_errors (where_, message) values ('old-r1', 'kept row 1'), ('old-r1', 'kept row 2')", db)
        r1 = sh(f'{psql(db)} -v ON_ERROR_STOP=1 -q -f {sqlf}'); r2 = sh(f'{psql(db)} -v ON_ERROR_STOP=1 -q -f {sqlf}')
        col = q("select data_type || ' ' || is_nullable || ' ' || column_default from information_schema.columns where table_name='app_errors' and column_name='repeats'", db)
        check(f'13 Part 2a twice on a {rev} database: no errors, repeats int not null default 1',
              r0.returncode == 0 and r1.returncode == 0 and r2.returncode == 0 and col == 'integer NO 1', (r0.stderr[:120], r1.stderr[:200], r2.stderr[:200], col))
        if db == 'tfr2_r1':
            kept = q("select count(*) || ' ' || min(repeats) from app_errors where where_='old-r1'", db)
            check('13 round-1 database: existing app_errors rows kept, repeats = 1', kept == '2 1', kept)
        drop_db(db)

    # 14. health timing and no values
    S = Server()
    try:
        ts = []
        for _ in range(100):
            t0 = time.time(); s, j, body = health(); ts.append(time.time() - t0)
        note(f'plan 14: 100 back-to-back /api/health on the local DB: avg {sum(ts)/len(ts)*1000:.1f} ms, max {max(ts)*1000:.1f} ms, last {s} {body}')
        check('14 health ok on the healthy copy', s == 200 and j.get('status') == 'ok', body)
        await shoot(b, '/api/health', 'health_ok')
    finally:
        S.stop()
    S = Server(**PROD, CASHFREE_APP_ID='TEST99secretish', CASHFREE_SECRET_KEY='cfsk_ma_test_SUPERSECRET', DEMO_PAYMENTS='1', RESEND_API_KEY='re_live_SECRET123', ADMIN_EMAILS='admin@thefest.in')
    try:
        bad = set()
        for _ in range(100):
            s, j, body = health()
            for x in j.get('problems', []) + j.get('warnings', []):
                if not (re.fullmatch(r'[A-Z_]+', x) or re.fullmatch(r'database setup incomplete: [a-z_., ]+', x)): bad.add(x)
            if any(v in body for v in ('TEST99', 'SUPERSECRET', 're_live', 'postgres://', 'thefest.example', 'admin@')): bad.add(body)
        check('14 misconfigured production health ×100: problems are names only, no value ever', not bad and s == 503, (bad, body))
        await shoot(b, '/api/health', 'health_misconfigured')
        adm = await login(b, 'admin@thefest.in')
        await shoot(b, '/admin', 'system_demo_in_prod', await adm.context.cookies(), 'section[aria-label=System]')
        pg = adm; await pg.goto(BASE + '/admin')
        txt = await pg.locator('section[aria-label=System]').inner_text()
        check('18 System card (production + DEMO_PAYMENTS=1) names DEMO_PAYMENTS_IN_PRODUCTION, no key values', 'DEMO_PAYMENTS_IN_PRODUCTION' in txt and 'SUPERSECRET' not in txt and 'TEST99' not in txt, txt)
    finally:
        S.stop()
    # all good, production
    S = Server(VERCEL_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', **CF_LIVE, CASHFREE_ENV='production', RESEND_API_KEY='re_fake_for_card', ADMIN_EMAILS='admin@thefest.in')
    try:
        s, j, body = health()
        adm = await login(b, 'admin@thefest.in'); await adm.goto(BASE + '/admin')
        txt = await adm.locator('section[aria-label=System]').inner_text()
        check('18 production with everything set: health ok and the System card says all good / production',
              s == 200 and 'warnings' not in body and 'all good' in txt.lower() and re.search(r'Environment\s*production', txt) is not None, (body, txt))
        await shoot(b, '/admin', 'system_all_good_prod', await adm.context.cookies(), 'section[aria-label=System]')
    finally:
        S.stop()

# ───────────────────────── D2. error log ─────────────────────────
async def section_errors(b):
    S = Server(E2E_ERROR_ROUTE='1')
    try:
        q("update app_errors set at = at - interval '10 minutes' where where_ like '%test-error%'")
        t0 = q('select now()'); rows0 = int(q('select count(*) from app_errors'))
        ths = [threading.Thread(target=http, args=('/api/test-error',)) for _ in range(20)]
        [t.start() for t in ths]; [t.join() for t in ths]; await asyncio.sleep(1)
        row = q(f"select count(*) || ' ' || coalesce(sum(repeats), 0) from app_errors where at >= '{t0}' and where_ like '%test-error%'").split()
        check('15 20 parallel identical errors: ≤ 2 rows added, sum(repeats) = 20', int(row[0]) <= 2 and row[1] == '20', row)
        note(f'plan 15: 20 parallel identical errors made {row[0]} row(s); table grew by {int(q("select count(*) from app_errors")) - rows0}')
        adm = await login(b, 'admin@thefest.in')
        await shoot(b, '/admin/errors', 'errors_20times', await adm.context.cookies())
        await adm.goto(BASE + '/admin/errors')
        # parallel errors may land in 2 rows (allowed by check 15): look for the biggest row's count
        top = q(f"select max(repeats) from app_errors where at >= '{t0}' and where_ like '%test-error%'")
        check(f'18 /admin/errors shows the "N times, last …" row (N = {top})', await adm.locator(f'text=/{top} times, last/').count() >= 1, top)
        # 16. pruning reached naturally
        q("insert into app_errors (at, where_, message) select now() - interval '40 days', 'old ' || g, 'old error ' || g from generate_series(1, 60) g")
        q("insert into app_errors (at, where_, message) select now() - interval '1 hour', 'bulk ' || g, 'bulk error ' || g from generate_series(1, 5100) g")
        hit = None
        for i in range(60):
            q("update app_errors set at = at - interval '10 minutes' where where_ like '%test-error%' and at > now() - interval '10 minutes'")
            http('/api/test-error'); await asyncio.sleep(0.2)
            mx = int(q('select max(id) from app_errors'))
            if mx % 50 == 0: hit = (i + 1, mx); break
        await asyncio.sleep(1)
        left = q("select count(*) || ' ' || count(*) filter (where at < now() - interval '30 days') from app_errors").split()
        newest = q("select count(*) from app_errors where where_ like '%test-error%' and at > now() - interval '1 minute'")
        check('16 5,160 seeded rows, new errors until an id ÷ 50: ≤ 5,000 rows, none older than 30 days, newest kept',
              hit and int(left[0]) <= 5000 and left[1] == '0' and newest == '1', (hit, left, newest))
        q("delete from app_errors where where_ like 'bulk %' or where_ like 'old %'")
    finally:
        S.stop()

# ───────────────────────── E. /setup/keys ─────────────────────────
async def section_keys(b):
    def body(k): return re.sub(r'-----[A-Z ]+-----|\\n|\s|"', '', k)
    server_pub = [l for l in open(os.path.join(ROOT, '.env.local')) if l.startswith('TICKET_PUBLIC_KEY=')]
    cur = body(server_pub[0].split('=', 1)[1]) if server_pub else None
    S = Server()
    try:
        for w, opts in (('390', MOBILE), ('1280', DESKTOP)):
            pg = await (await b.new_context(**opts)).new_page(); sent = []
            pg.on('request', lambda r: sent.append(r.method + ' ' + r.url + ' ' + (r.post_data or '')))
            await pg.goto(BASE + '/setup/keys'); await pg.wait_for_load_state('networkidle')
            await pg.screenshot(path=f'{SHOTS}/keys_set_{w}.png', full_page=True)
            await pg.click('summary:has-text("another environment")')
            await pg.click('button:has-text("Make a pair for another environment")')
            await pg.wait_for_selector('textarea[aria-label=TICKET_PUBLIC_KEY]')
            pub1 = await pg.locator('textarea[aria-label=TICKET_PUBLIC_KEY]').input_value(); priv1 = await pg.locator('textarea[aria-label=TICKET_PRIVATE_KEY]').input_value()
            await pg.screenshot(path=f'{SHOTS}/keys_set_pair1_{w}.png', full_page=True)
            await pg.click('button:has-text("Make a different pair")'); await pg.wait_for_timeout(600)
            pub2 = await pg.locator('textarea[aria-label=TICKET_PUBLIC_KEY]').input_value(); priv2 = await pg.locator('textarea[aria-label=TICKET_PRIVATE_KEY]').input_value()
            p1, p2, k1, k2 = body(pub1), body(pub2), body(priv1), body(priv2)
            check(f'17 {w}px keys set: two pairs differ from each other and from the site key', p1 != p2 and k1 != k2 and cur and len(cur) > 80 and cur not in (p1, p2), (p1[36:60], p2[36:60], cur and cur[36:60]))
            parts = [k1[70:100], k2[70:100]]   # inside the second 64-character line, so unbroken in any format
            check(f'17 {w}px keys set: nothing POSTed, no request carries a private key', not any(s.startswith('POST') for s in sent) and not any(p in s for s in sent for p in parts), len(sent))
            check(f'17 {w}px keys set: no sideways scroll', await no_sideways(pg))
            await pg.screenshot(path=f'{SHOTS}/keys_set_pair2_{w}.png', full_page=True)
            await pg.context.close()
    finally:
        S.stop()
    S = Server(TICKET_PRIVATE_KEY='', TICKET_PUBLIC_KEY='')
    try:
        for w, opts in (('390', MOBILE), ('1280', DESKTOP)):
            pg = await (await b.new_context(**opts)).new_page()
            await pg.goto(BASE + '/setup/keys'); await pg.wait_for_load_state('networkidle')
            await pg.screenshot(path=f'{SHOTS}/keys_unset_{w}.png', full_page=True)
            btn = pg.locator('button:has-text("Make")').first
            if await btn.count(): await btn.click(); await pg.wait_for_timeout(800)
            await pg.screenshot(path=f'{SHOTS}/keys_unset_made_{w}.png', full_page=True)
            check(f'17 {w}px keys NOT set: page makes a pair, no sideways scroll', await pg.locator('textarea').count() >= 2 and await no_sideways(pg))
            await pg.context.close()
        s, j, body = health()
        await shoot(b, '/api/health', 'health_nokeys')
        note(f'health with ticket keys unset (development): {s} {body}')
    finally:
        S.stop()

asyncio.run(main())

# Production-readiness checks. Starts its own servers (next start) with different settings on :3001/:3002,
# next to the main release-check server on :3000. Same local database unless noted.
#   • card checkout off without a live gateway; demo never in production; test keys refused in production
#   • /api/health: problems by name only, 503; db down; no secret values
#   • no localhost links in production; preview uses the branch URL
#   • DB-backed login throttle shared across servers and restarts (app + scanner login)
#   • Secure session cookies in production
#   • /setup/keys makes a working key pair in the browser without sending the private key
#   • empty database: every portal renders an empty state at 390px; admin needs a confirmed email
import asyncio, json, os, re, signal, subprocess, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
MAIN = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
LOCAL_DB = 'postgres://postgres@localhost:5432/thefest'
EMPTY_DB = 'postgres://postgres@localhost:5432/thefest_empty'
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def qe(sql): return q(sql, 'psql -h /tmp -U postgres thefest_empty')

# Settings that .env.local or the release check would otherwise supply. '' = unset (Next.js won't override it).
BASE_ENV = {'DEMO_PAYMENTS': '', 'E2E_ERROR_ROUTE': '', 'ADMIN_EMAILS': '', 'APP_ENV': '', 'VERCEL_ENV': '',
            'CASHFREE_APP_ID': '', 'CASHFREE_SECRET_KEY': '', 'CASHFREE_ENV': '', 'RAZORPAY_KEY_ID': '', 'RAZORPAY_KEY_SECRET': '',
            'RESEND_API_KEY': ''}

def http(base, path):
    try:
        r = urllib.request.urlopen(base + path, timeout=20); return r.status, r.headers, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode()

class Server:
    def __init__(self, port, **env):
        self.port, self.base = port, f'http://localhost:{port}'
        e = os.environ.copy(); e.update(BASE_ENV); e.update(env); e['PORT'] = str(port)
        self.log = open(f'{E2E}/server-{port}.log', 'a')
        self.p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', str(port)], cwd=ROOT, env=e,
                                  stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            try:
                urllib.request.urlopen(self.base + '/legal/terms', timeout=3); return
            except urllib.error.HTTPError:
                return
            except Exception:
                time.sleep(0.5)
        raise RuntimeError(f'server on {port} did not start')
    def stop(self):
        try: os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        self.p.wait(15); self.log.close()

async def login(b, base, email, pw='password123', url='/login'):
    ctx = await b.new_context(**MOBILE); pg = await ctx.new_page()
    await pg.goto(base + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def try_login(pg, base, email, pw, url='/login'):
    await pg.goto(base + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return (await pg.locator('.alert.error').text_content()) if await pg.locator('.alert.error').count() else ''

async def post(pg, path, data):
    return await pg.evaluate("""([p, d]) => fetch(p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d)})
        .then(async r => ({status: r.status, body: await r.json().catch(() => ({}))}))""", [path, data])

async def no_sideways(pg):
    return await pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

def tt(slug, name): return q(f"select tt.id from ticket_types tt join fests f on f.id=tt.fest_id where f.slug='{slug}' and tt.name='{name}'")
def sold(tid): return q(f"select sold from ticket_types where id='{tid}'")

async def card_off_checks(b, srv, label, msg='isn’t open yet'):
    """Paid card checkout refused with 503 before any seat is held."""
    st = await login(b, srv.base, 'student@thefest.in')
    paid = tt('kalaa-fest', 'General')
    s0, o0 = sold(paid), q("select count(*) from orders")
    r = await post(st, '/api/checkout', {'ticketTypeId': paid, 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
    check(f'{label}: paid card checkout → 503 "{msg}"', r['status'] == 503 and msg in r['body'].get('error', ''), r)
    check(f'{label}: no seat held, no order created', sold(paid) == s0 and q("select count(*) from orders") == o0, (s0, sold(paid)))
    return st

async def main():
    os.makedirs(E2E, exist_ok=True)
    env_local = open(os.path.join(ROOT, '.env.local')).read()
    m = re.search(r'^TICKET_PRIVATE_KEY=(.*)$', env_local, re.M)
    priv_fragment = (m.group(1).strip().strip('"').split('\\n')[1][:24]) if m else 'nokey'
    # Bank UPI on for Kalaa Fest during these checks (restored at the end)
    kalaa_upi = q("select upi_enabled::text || '|' || coalesce(upi_vpa,'') from fests where slug='kalaa-fest'")
    q("update fests set upi_enabled = true, upi_vpa = 'kalaafest@okaxis', upi_name = 'Kalaa Fest' where slug = 'kalaa-fest'")
    q("delete from login_attempts")

    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── A. Local, no gateway keys, DEMO_PAYMENTS unset (criteria 1, 2, 6) ─────────────
        A = Server(3001)
        try:
            st = await card_off_checks(b, A, 'local without demo')
            own = q("select o.id from orders o join users u on u.id=o.user_id where u.email='student@thefest.in' limit 1")
            r = await post(st, '/api/checkout/demo-confirm', {'orderId': own})
            check('local without demo: demo-confirm → 404', r['status'] == 404, r)
            free = tt('hackverse', 'Hacker (team member)')
            r = await post(st, '/api/checkout', {'ticketTypeId': free, 'qty': 1, 'method': 'gateway'})
            check('gateway off: free ticket still issues', r['status'] == 200 and r['body'].get('mode') == 'done', r)
            r = await post(st, '/api/checkout', {'ticketTypeId': tt('kalaa-fest', 'General'), 'qty': 1, 'method': 'upi_direct'})
            check('gateway off: bank-UPI checkout still returns mode upi', r['status'] == 200 and r['body'].get('mode') == 'upi', r)
            if r['body'].get('orderId'): await post(st, '/api/checkout/cancel', {'orderId': r['body']['orderId']})
            # Fest page at 390px
            await st.goto(A.base + '/fests/kalaa-fest'); await st.wait_for_load_state('networkidle')
            box = st.locator('#tickets')
            check('fest page (UPI on): no card option', await box.locator('text=Card / UPI checkout').count() == 0)
            check('fest page (UPI on): "opens soon" note', await box.locator('text=Online card/UPI payment opens soon').count() == 1)
            check('fest page (UPI on): pay-by-UPI button', await box.locator('button:has-text("by UPI")').count() == 1)
            check('fest page (UPI on): no sideways scroll at 390px', await no_sideways(st))
            await st.screenshot(path=f'{E2E}/card_off_upi_390.png', full_page=True)
            q("update fests set upi_enabled = false where slug = 'hackverse'")
            await st.goto(A.base + '/fests/hackverse'); await st.wait_for_load_state('networkidle')
            await st.locator('#tickets label:has-text("Workshop Pass")').click()
            btn = st.locator('#tickets button:has-text("Not on sale online yet")')
            check('fest page (no UPI): "Not on sale online yet", disabled', await btn.count() == 1 and await btn.is_disabled())
            check('fest page (no UPI): "opens soon" note', await st.locator('#tickets >> text=Online card/UPI payment opens soon').count() == 1)
            check('fest page (no UPI): no sideways scroll at 390px', await no_sideways(st))
            await st.screenshot(path=f'{E2E}/card_off_none_390.png', full_page=True)

            # ── Login throttle across servers (criterion 13) ──
            other = await (await b.new_context(**MOBILE)).new_page()
            for i in range(10):
                await try_login(other, MAIN, 'sponsor@thefest.in', 'wrong-password')
            # Keys since fix round 1: per email + network ('ip:<email>|<ip>') and per email ('e:<email>')
            check('10 failed logins counted in the database (per network and per email)',
                  q("select string_agg(fails::text, ',' order by key) from login_attempts where key like 'ip:sponsor@thefest.in|%' or key = 'e:sponsor@thefest.in'") == '10,10',
                  q("select string_agg(key || '=' || fails, ',') from login_attempts where key like '%sponsor@thefest.in%'"))
            other2 = await (await b.new_context(**MOBILE)).new_page()
            msg = await try_login(other2, A.base, 'sponsor@thefest.in', 'password123')
            check('11th attempt on the OTHER server, right password → "Too many attempts"', 'Too many attempts' in msg, msg)
            msg = await try_login(other2, A.base, 'sponsor@thefest.in', 'password123', url='/scan/login')
            check('scanner login shares the same counter', 'Too many attempts' in msg, msg)
        finally:
            A.stop()
        A = Server(3001)
        try:
            pg = await (await b.new_context(**MOBILE)).new_page()
            msg = await try_login(pg, A.base, 'sponsor@thefest.in', 'password123')
            check('restarting the server does not reset the throttle', 'Too many attempts' in msg, msg)
            q("update login_attempts set window_start = now() - interval '16 minutes'")
            await try_login(pg, A.base, 'sponsor@thefest.in', 'password123')
            check('after 15 minutes the right password works', pg.url.endswith('/sponsor'), pg.url)
            check('successful login clears the counter', q("select count(*) from login_attempts where key='sponsor@thefest.in'") == '0')
        finally:
            A.stop()

        # ── B. Production, DEMO_PAYMENTS=1 (ignored), no site URL / email / admins (criteria 4, 11, 22) ──
        t0 = q("select now()")
        demo_paid = q("select count(*) from orders where provider='demo' and status='paid'")
        P = Server(3001, APP_ENV='production', DEMO_PAYMENTS='1', NEXT_PUBLIC_SITE_URL='')
        try:
            s, h, body = http(P.base, '/api/health'); j = json.loads(body)
            check('prod: health 503 misconfigured', s == 503 and j.get('status') == 'misconfigured', body)
            check('prod: health lists NEXT_PUBLIC_SITE_URL, RESEND_API_KEY, ADMIN_EMAILS',
                  all(n in j.get('problems', []) for n in ['NEXT_PUBLIC_SITE_URL', 'RESEND_API_KEY', 'ADMIN_EMAILS']), body)
            check('prod: NO_LIVE_GATEWAY is a warning', 'NO_LIVE_GATEWAY' in j.get('warnings', []), body)
            # Cookies: watch Set-Cookie on the login response
            ctx = await b.new_context(**MOBILE); pg = await ctx.new_page(); cookies = []
            async def grab(resp):
                try:
                    for hh in await resp.headers_array():
                        if hh['name'].lower() == 'set-cookie': cookies.append(hh['value'])
                except Exception: pass
            pg.on('response', grab)
            await pg.goto(P.base + '/login'); await pg.fill('input[name=email]', 'student@thefest.in'); await pg.fill('input[name=password]', 'password123')
            await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
            sc = next((c for c in cookies if c.startswith('tf_session=')), '')
            check('prod: tf_session is HttpOnly; Secure; SameSite=Lax with an expiry',
                  all(x in sc.lower() for x in ['httponly', 'secure', 'samesite=lax', 'expires=']), sc.split(';', 1)[-1])
            r = await post(pg, '/api/checkout', {'ticketTypeId': tt('kalaa-fest', 'General'), 'qty': 1, 'method': 'gateway', 'phone': '9876543210'})
            check('prod + DEMO_PAYMENTS=1: checkout is not demo (503)', r['status'] == 503 and r['body'].get('mode') != 'demo', r)
            own = q("select o.id from orders o join users u on u.id=o.user_id where u.email='student@thefest.in' limit 1")
            r = await post(pg, '/api/checkout/demo-confirm', {'orderId': own})
            check('prod + DEMO_PAYMENTS=1: demo-confirm → 404', r['status'] == 404, r)
            check('prod: no new paid demo orders', q("select count(*) from orders where provider='demo' and status='paid'") == demo_paid)
            await pg.goto(P.base + '/fests/kalaa-fest'); await pg.wait_for_load_state('networkidle')
            check('prod: fest page offers no demo payment', await pg.locator('text=demo mode').count() == 0 and await pg.locator('text=(demo)').count() == 0)
            # A free ticket still issues; its email isn't sent with a localhost link
            r = await post(pg, '/api/checkout', {'ticketTypeId': tt('hackverse', 'Hacker (team member)'), 'qty': 1, 'method': 'gateway'})
            check('prod: free ticket still issues', r['body'].get('mode') == 'done', r)
            # Scanner cookie
            cookies.clear()
            vol = await (await b.new_context(**MOBILE)).new_page(); vol.on('response', grab)
            await vol.goto(P.base + '/scan/login'); await vol.fill('input[name=email]', 'volunteer@thefest.in'); await vol.fill('input[name=password]', 'password123')
            await vol.click('button[type=submit]'); await vol.wait_for_load_state('networkidle')
            sc = next((c for c in cookies if c.startswith('tf_scan=')), '')
            check('prod: tf_scan is HttpOnly; Secure; SameSite=Lax and has NO expiry',
                  sc and all(x in sc.lower() for x in ['httponly', 'secure', 'samesite=lax']) and 'expires=' not in sc.lower() and 'max-age' not in sc.lower(), sc.split(';', 1)[-1])
            # Sign-up and password reset must not email localhost links
            new = await (await b.new_context(**MOBILE)).new_page()
            await new.goto(P.base + '/signup'); await new.fill('input[name=name]', 'Prod Tester'); await new.fill('input[name=email]', 'prod-tester@example.com')
            await new.fill('input[name=password]', 'password123'); await new.click('button[type=submit]'); await new.wait_for_load_state('networkidle')
            check('prod: sign-up still works without a site URL', new.url.endswith('/fests'), new.url)
            await new.goto(P.base + '/forgot-password'); await new.fill('input[name=email]', 'student@thefest.in'); await new.click('button[type=submit]')
            await new.wait_for_selector('.alert')
            check('prod: password reset says plainly it is not switched on', 'aren’t switched on yet' in (await new.locator('.alert').text_content()))
            await asyncio.sleep(1.5)
            check('prod: no email with a localhost link was created', q(f"select count(*) from email_outbox where created_at >= '{t0}' and body_text like '%localhost%'") == '0')
            check('prod: the missing site URL is logged as an error', q(f"select count(*) from app_errors where at >= '{t0}' and message like '%NEXT_PUBLIC_SITE_URL%'") != '0')
        finally:
            P.stop()

        # ── C. Production with Cashfree SANDBOX keys + mismatched public key (criteria 5, 9) ──
        other_pub = subprocess.run(['node', 'scripts/gen-keys.mjs'], cwd=ROOT, capture_output=True, text=True).stdout
        other_pub = re.search(r'TICKET_PUBLIC_KEY="(.*)"', other_pub).group(1)
        C = Server(3001, APP_ENV='production', CASHFREE_APP_ID='TEST123', CASHFREE_SECRET_KEY='cfsk_ma_test_fake', CASHFREE_ENV='sandbox',
                   NEXT_PUBLIC_SITE_URL='https://thefest.example')
        try:
            s, h, body = http(C.base, '/api/health'); j = json.loads(body)
            check('prod + Cashfree sandbox keys: health lists GATEWAY_TEST_KEYS_IN_PRODUCTION', s == 503 and 'GATEWAY_TEST_KEYS_IN_PRODUCTION' in j.get('problems', []), body)
            check('health never shows key values', 'cfsk' not in body and 'TEST123' not in body and 'BEGIN' not in body)
            # A real Cashfree call with these fake keys would fail with 502 "provider unavailable"; 503 proves none was made
            await card_off_checks(b, C, 'prod + Cashfree sandbox keys (no Cashfree call)')
        finally:
            C.stop()
        C = Server(3001, TICKET_PUBLIC_KEY=other_pub)
        try:
            s, h, body = http(C.base, '/api/health'); j = json.loads(body)
            check('public key from another pair → TICKET_KEYS_MISMATCH (503)', s == 503 and 'TICKET_KEYS_MISMATCH' in j.get('problems', []), body)
        finally:
            C.stop()

        # ── D. Production with a Razorpay TEST key (criterion 5) ──
        D = Server(3001, APP_ENV='production', RAZORPAY_KEY_ID='rzp_test_FAKE123', RAZORPAY_KEY_SECRET='rzpsecretfake')
        try:
            s, h, body = http(D.base, '/api/health'); j = json.loads(body)
            check('prod + rzp_test_ key: GATEWAY_TEST_KEYS_IN_PRODUCTION', s == 503 and 'GATEWAY_TEST_KEYS_IN_PRODUCTION' in j.get('problems', []), body)
            check('health never shows Razorpay key values', 'rzp_test_FAKE' not in body and 'rzpsecret' not in body)
            await card_off_checks(b, D, 'prod + Razorpay test key')
        finally:
            D.stop()

        # ── D2. Production without TICKET_PRIVATE_KEY (criterion 8) ──
        D = Server(3001, APP_ENV='production', TICKET_PRIVATE_KEY='', TICKET_PUBLIC_KEY='')
        try:
            s, h, body = http(D.base, '/api/health'); j = json.loads(body)
            check('prod without TICKET_PRIVATE_KEY → 503 listing it', s == 503 and 'TICKET_PRIVATE_KEY' in j.get('problems', []), body)
            check('health body has no secret values', not any(x in body for x in ['BEGIN', 'postgres://', 'postgresql://', priv_fragment]), body)
            st = await card_off_checks(b, D, 'prod without signing keys', msg='paused')
            r = await post(st, '/api/checkout', {'ticketTypeId': tt('hackverse', 'Hacker (team member)'), 'qty': 1, 'method': 'gateway'})
            check('prod without signing keys: even free tickets pause with a clear message', r['status'] == 503 and 'paused' in r['body'].get('error', ''), r)
            tid = q("select t.id from tickets t join users u on u.id=t.user_id where u.email='student@thefest.in' and t.status='valid' limit 1")
            resp = await st.goto(f'{D.base}/tickets/{tid}')
            check('prod without signing keys: ticket page shows the backup code, not a crash', resp.status == 200 and await st.locator('text=QR code can’t be shown right now').count() == 1, resp.status)
        finally:
            D.stop()

        # ── E. Production, DATABASE_URL on the direct db. host, port 5432, unreachable (criterion 10) ──
        E = Server(3001, APP_ENV='production', DATABASE_URL='postgresql://postgres:supersecretpw@db.thefest.invalid:5432/postgres')
        try:
            s, h, body = http(E.base, '/api/health'); j = json.loads(body)
            check('database unreachable → 503 db down', s == 503 and j.get('db') == 'down' and j.get('status') == 'down', body)
            check('direct/5432 database URL → DATABASE_URL_NOT_TRANSACTION_POOLER', 'DATABASE_URL_NOT_TRANSACTION_POOLER' in j.get('problems', []), body)
            check('health never shows the database password', 'supersecretpw' not in body and 'postgres' not in body)
        finally:
            E.stop()

        # ── F. Preview: links use the branch URL (criterion 11, second half) ──
        F = Server(3001, VERCEL_ENV='preview', VERCEL_BRANCH_URL='x-git-full-app.vercel.app', NEXT_PUBLIC_SITE_URL='')
        try:
            pg = await (await b.new_context(**MOBILE)).new_page()
            await pg.goto(F.base + '/forgot-password'); await pg.fill('input[name=email]', 'organizer2@thefest.in'); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.alert.ok')
            body = q("select body_text from email_outbox where to_email='organizer2@thefest.in' and subject like 'Reset%' order by id desc limit 1")
            link = next((l.strip() for l in body.splitlines() if 'reset-password?token=' in l), '')
            check('preview: reset link starts with https://x-git-full-app.vercel.app/', link.startswith('https://x-git-full-app.vercel.app/reset-password?token='), link[:60])
        finally:
            F.stop()

        # ── G. Empty database: keys page, empty states, admin needs a confirmed email (criteria 14, 19, 20) ──
        subprocess.run('dropdb -h /tmp -U postgres --if-exists thefest_empty && createdb -h /tmp -U postgres thefest_empty', shell=True, check=True)
        subprocess.run(['node', 'scripts/db-setup.mjs'], cwd=ROOT, env={**os.environ, 'DATABASE_URL': EMPTY_DB}, check=True, capture_output=True)
        G = Server(3002, DATABASE_URL=EMPTY_DB, TICKET_PRIVATE_KEY='', TICKET_PUBLIC_KEY='')
        try:
            pg = await (await b.new_context(**MOBILE)).new_page(); sent = []
            pg.on('request', lambda r: sent.append((r.url, r.post_data or '')))
            await pg.goto(G.base + '/setup/keys'); await pg.wait_for_load_state('networkidle')
            await pg.click('button:has-text("Make keys")')
            await pg.wait_for_selector('textarea[aria-label=TICKET_PRIVATE_KEY]')
            priv = await pg.locator('textarea[aria-label=TICKET_PRIVATE_KEY]').input_value()
            pub = await pg.locator('textarea[aria-label=TICKET_PUBLIC_KEY]').input_value()
            await pg.wait_for_timeout(500)
            body_part = priv.split('\\n')[1][:30] if '\\n' in priv else priv[:30]
            check('/setup/keys makes a PEM key pair in the browser', priv.startswith('-----BEGIN PRIVATE KEY-----\\n') and pub.startswith('-----BEGIN PUBLIC KEY-----\\n'), priv[:40])
            check('no request carries the private key', not any(body_part in u or body_part in d for u, d in sent), len(sent))
            check('/setup/keys fits 390px', await no_sideways(pg))
            await pg.screenshot(path=f'{E2E}/setup_keys_390.png', full_page=True)
        finally:
            G.stop()

        # The browser-made pair works: sign a ticket with it and scan it on a server using it
        A = Server(3001, TICKET_PRIVATE_KEY=priv, TICKET_PUBLIC_KEY=pub)
        try:
            tid, fid = q("select t.id || ' ' || t.fest_id from tickets t join fests f on f.id=t.fest_id where f.slug='neon-utsav' and t.status='valid' order by t.issued_at desc limit 1").split()
            payload = subprocess.run(['node', 'scripts/sign-ticket.mjs', tid, fid], cwd=ROOT, env={**os.environ, 'TICKET_PRIVATE_KEY': priv}, capture_output=True, text=True).stdout.strip().splitlines()[-1]
            vol = await login(b, A.base, 'volunteer@thefest.in', url='/scan/login')
            r = await post(vol, '/api/scan', {'festId': fid, 'gate': 'Gate 1', 'payload': payload})
            check('ticket signed with the browser-made key scans "Welcome in!"', r['body'].get('result') == 'admitted', r['body'].get('message'))
            s, h, body = http(A.base, '/api/health')
            check('health is ok with the browser-made keys', s == 200, body)
        finally:
            A.stop()

        G = Server(3002, DATABASE_URL=EMPTY_DB, TICKET_PRIVATE_KEY=priv, TICKET_PUBLIC_KEY=pub, ADMIN_EMAILS='boss@example.com')
        try:
            pg = await (await b.new_context(**MOBILE)).new_page()
            for path in ['/', '/fests', '/login', '/signup', '/scan/login', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/contact', '/legal/delivery', '/api/health', '/setup/keys']:
                r = await pg.goto(G.base + path)
                check(f'empty DB, logged out: {path} renders (status {r.status})', r.status < 500 and (path == '/api/health' or await no_sideways(pg)))
            async def signup(email, role):
                c = await (await b.new_context(**MOBILE)).new_page()
                await c.goto(f'{G.base}/signup?role={role}'); await c.fill('input[name=name]', f'New {role}'); await c.fill('input[name=email]', email)
                await c.fill('input[name=password]', 'password123'); await c.click('button[type=submit]'); await c.wait_for_load_state('networkidle')
                return c
            for role, email, paths in [('organizer', 'org@example.com', ['/organizer', '/organizer/new']), ('student', 'stu@example.com', ['/tickets', '/me', '/fests']), ('sponsor', 'spo@example.com', ['/sponsor'])]:
                c = await signup(email, role)
                for path in paths:
                    r = await c.goto(G.base + path)
                    # a new organizer with no fest is sent straight to "create your fest"
                    landed = c.url.endswith(path) or (path == '/organizer' and c.url.endswith('/organizer/new'))
                    check(f'empty DB, new {role}: {path} renders at 390px', r.status < 500 and landed and await no_sideways(c), (r.status, c.url))
            boss = await signup('boss@example.com', 'organizer')
            await boss.goto(G.base + '/admin')
            check('ADMIN_EMAILS account without a confirmed email does NOT get /admin', '/admin' not in boss.url, boss.url)
            body = qe("select body_text from email_outbox where to_email='boss@example.com' order by id desc limit 1")
            link = next((l.strip() for l in body.splitlines() if 'verify-email?token=' in l), '')
            await boss.goto(G.base + link[link.index('/verify-email'):]); await boss.wait_for_load_state('networkidle')
            for path in ['/admin', '/admin/fests', '/admin/orders', '/admin/errors']:
                r = await boss.goto(G.base + path)
                check(f'empty DB, confirmed admin: {path} renders at 390px', r.status < 500 and boss.url.endswith(path) and await no_sideways(boss), (r.status, boss.url))
        finally:
            G.stop()
        await b.close()

    q("update fests set upi_enabled = false where slug = 'hackverse'")
    q(f"update fests set upi_enabled = {kalaa_upi.split('|')[0]}, upi_vpa = nullif('{kalaa_upi.split('|')[1]}', '') where slug = 'kalaa-fest'")
    q("delete from login_attempts")
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} production-readiness checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

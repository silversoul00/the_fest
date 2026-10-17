# More production-readiness checks (tester round 1). Own servers on :3004. Local Postgres only.
#   6. Production database without the new login_attempts table: what login, scanner unlock and /api/health do
#   8. /setup/keys: "Make keys" then "Make a different pair" gives two different pairs; both work on a server
#   9. /setup/keys: no request carries any piece of either private key
#  10. 50 server errors in a burst → exactly one alert email; rows recorded; students/organizers get no admin pages
#  11. Signing keys removed: a ticket page left open for 2 minutes, error rows written
import asyncio, base64, json, os, re, signal, subprocess, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
PORT = 3004
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
QUICK = os.environ.get('PROD_EXTRA_QUICK') == '1'   # shortens the 2-minute ticket-page wait
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def note(text): print('   NOTE ' + text)
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()

BASE_ENV = {'DEMO_PAYMENTS': '', 'E2E_ERROR_ROUTE': '', 'ADMIN_EMAILS': '', 'APP_ENV': '', 'VERCEL_ENV': '',
            'CASHFREE_APP_ID': '', 'CASHFREE_SECRET_KEY': '', 'CASHFREE_ENV': '', 'RAZORPAY_KEY_ID': '', 'RAZORPAY_KEY_SECRET': '', 'RESEND_API_KEY': ''}

class Server:
    def __init__(self, **env):
        self.base = f'http://localhost:{PORT}'
        e = os.environ.copy(); e.update(BASE_ENV); e.update(env); e['PORT'] = str(PORT)
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

def http(base, path):
    try:
        r = urllib.request.urlopen(base + path, timeout=20); return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

async def try_login(b, base, email, url='/login', pw='password123'):
    pg = await (await b.new_context(**MOBILE)).new_page()
    resp = []
    pg.on('response', lambda r: resp.append(r.status) if r.request.method == 'POST' else None)
    await pg.goto(base + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(500)
    text = (await pg.locator('body').inner_text())[:200].replace('\n', ' ')
    return pg, resp, text

async def main():
    os.makedirs(E2E, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── 6. Production DB missing login_attempts ──
        subprocess.run('dropdb -h /tmp -U postgres --if-exists thefest_old && createdb -h /tmp -U postgres thefest_old && '
                       'pg_dump -h /tmp -U postgres thefest | psql -q -h /tmp -U postgres thefest_old >/dev/null 2>&1', shell=True, check=True)
        q('drop table login_attempts', 'psql -h /tmp -U postgres thefest_old')
        S = Server(DATABASE_URL='postgres://postgres@localhost:5432/thefest_old')
        try:
            s, body = http(S.base, '/api/health')
            check('missing login_attempts: /api/health is NOT "ok" (Finding 2)', s != 200 or '"ok"' not in body, (s, body))
            pg, resp, text = await try_login(b, S.base, 'student@thefest.in')
            note(f'missing login_attempts, app login → url={pg.url} POST statuses={resp} page="{text[:120]}"')
            # Recorded, not asserted: the agreed fix (Finding 2) is that health reports the outdated schema.
            pg, resp, text = await try_login(b, S.base, 'volunteer@thefest.in', url='/scan/login')
            note(f'missing login_attempts, scanner unlock → url={pg.url} POST statuses={resp} page="{text[:120]}"')
            await pg.screenshot(path=f'{E2E}/no_login_attempts_scan_390.png', full_page=True)
        finally:
            S.stop()
        subprocess.run('dropdb -h /tmp -U postgres --if-exists thefest_old', shell=True)

        # ── 8 + 9. /setup/keys: two pairs, nothing sent ──
        S = Server(TICKET_PRIVATE_KEY='', TICKET_PUBLIC_KEY='')
        try:
            pg = await (await b.new_context(**MOBILE)).new_page(); sent = []
            def rec(r):
                try: hdrs = json.dumps(r.headers)
                except Exception: hdrs = ''
                sent.append(r.method + ' ' + r.url + ' ' + (r.post_data or '') + ' ' + hdrs)
            pg.on('request', rec)
            pg.on('websocket', lambda ws: sent.append('websocket ' + ws.url))
            await pg.goto(S.base + '/setup/keys'); await pg.wait_for_load_state('networkidle')
            await pg.click('button:has-text("Make keys")'); await pg.wait_for_selector('textarea[aria-label=TICKET_PRIVATE_KEY]')
            priv1 = await pg.locator('textarea[aria-label=TICKET_PRIVATE_KEY]').input_value(); pub1 = await pg.locator('textarea[aria-label=TICKET_PUBLIC_KEY]').input_value()
            await pg.click('button:has-text("Make a different pair")'); await pg.wait_for_function(
                "v => document.querySelector('textarea[aria-label=TICKET_PRIVATE_KEY]').value !== v", arg=priv1)
            priv2 = await pg.locator('textarea[aria-label=TICKET_PRIVATE_KEY]').input_value(); pub2 = await pg.locator('textarea[aria-label=TICKET_PUBLIC_KEY]').input_value()
            # double tap: still one coherent pair on screen
            await pg.dblclick('button:has-text("Make a different pair")'); await pg.wait_for_timeout(800)
            await pg.click('button:has-text("Copy") >> nth=0')
            await pg.wait_for_timeout(800)
            check('/setup/keys: "Make a different pair" gives a new private and public key', priv1 != priv2 and pub1 != pub2 and priv2.startswith('-----BEGIN PRIVATE KEY-----'))
            frags = set()
            for k in (priv1, priv2):
                body64 = ''.join(k.split('\\n')[1:-1])
                frags.update(body64[i:i + 16] for i in range(0, len(body64) - 16, 8))
                raw = base64.b64decode(body64)
                frags.update(raw[i:i + 12].hex() for i in range(0, len(raw) - 12, 6))
            leaked = [s[:80] for s in sent if any(f in s for f in frags)]
            check('/setup/keys: no request, URL or header carries any 16-char piece of either private key', not leaked, (len(sent), leaked[:2]))
            check('/setup/keys: the page sends no POST and opens no websocket', not any(s.split(' ')[0] in ('POST', 'PUT', 'websocket') for s in sent), [s[:60] for s in sent if not s.startswith('GET')][:3])
            await pg.screenshot(path=f'{E2E}/setup_keys_two_pairs_390.png', full_page=True)
        finally:
            S.stop()
        # both pairs work: health ok and a signed ticket scans
        tid, fid = q("select t.id || ' ' || t.fest_id from tickets t join fests f on f.id=t.fest_id where f.slug='neon-utsav' and t.status='valid' order by t.issued_at desc limit 1").split()
        for i, (priv, pub) in enumerate([(priv1, pub1), (priv2, pub2)], 1):
            S = Server(TICKET_PRIVATE_KEY=priv, TICKET_PUBLIC_KEY=pub)
            try:
                s, body = http(S.base, '/api/health')
                payload = subprocess.run(['node', 'scripts/sign-ticket.mjs', tid, fid], cwd=ROOT, env={**os.environ, 'TICKET_PRIVATE_KEY': priv}, capture_output=True, text=True).stdout.strip().splitlines()[-1]
                vol, _, _ = await try_login(b, S.base, 'volunteer@thefest.in', url='/scan/login')
                r = await vol.evaluate("""([f, p]) => fetch('/api/scan', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({festId: f, gate: 'Gate 9', payload: p})}).then(r => r.json())""", [fid, payload])
                check(f'pair {i} from /setup/keys: health ok and its signed QR is recognised', s == 200 and r.get('result') in ('admitted', 'duplicate'), (s, body, r.get('result')))
            finally:
                S.stop()
        # keys set: what the page offers (Finding 3, recorded)
        S = Server()
        try:
            pg = await (await b.new_context(**MOBILE)).new_page(); await pg.goto(S.base + '/setup/keys')
            n = await pg.locator('button:has-text("Make")').count()
            note(f'/setup/keys with valid keys set: "Make…" buttons on page = {n} (Finding 3: no way to make the production pair)')
            await pg.screenshot(path=f'{E2E}/setup_keys_set_390.png', full_page=True)
        finally:
            S.stop()

        # ── 10. Error burst: one alert, rows, no admin pages for others ──
        q("delete from app_alert_state")
        q("update users set email_verified_at = coalesce(email_verified_at, now()) where email = 'admin@thefest.in'")
        t0 = q('select now()')
        S = Server(E2E_ERROR_ROUTE='1', ADMIN_EMAILS='admin@thefest.in')
        try:
            pg = await (await b.new_context()).new_page(); await pg.goto(S.base + '/legal/terms')
            codes = await pg.evaluate("Promise.all(Array.from({length: 50}, () => fetch('/api/test-error').then(r => r.status)))")
            await asyncio.sleep(2)
            rows = q(f"select count(*) from app_errors where at >= '{t0}'")
            mails = q(f"select count(*) from email_outbox where created_at >= '{t0}' and subject like '%new error%'")
            check('50 errors in a burst: all answered 500', set(codes) == {500}, set(codes))
            check('50 errors in a burst: exactly one alert email', mails == '1', mails)
            note(f'50 errors in a burst wrote {rows} app_errors rows (Finding 7: no de-duplication)')
            for who in ['student@thefest.in', 'organizer@thefest.in', 'sponsor@thefest.in']:
                u, _, _ = await try_login(b, S.base, who)
                for path in ['/admin', '/admin/errors', '/admin/orders']:
                    await u.goto(S.base + path); await u.wait_for_load_state('networkidle')
                    sys_card = await u.locator('section[aria-label=System]').count()
                    check(f'{who.split("@")[0]}: {path} redirected away, no System card', '/admin' not in u.url and sys_card == 0, u.url)
            anon = await (await b.new_context()).new_page(); await anon.goto(S.base + '/admin/errors')
            check('logged out: /admin/errors → login', '/login' in anon.url, anon.url)
        finally:
            S.stop()

        # ── 11. Keys removed, ticket page left open ──
        tid = q("select t.id from tickets t join users u on u.id=t.user_id where u.email='student@thefest.in' and t.status='valid' limit 1")
        S = Server(TICKET_PRIVATE_KEY='', TICKET_PUBLIC_KEY='')
        try:
            st, _, _ = await try_login(b, S.base, 'student@thefest.in')
            t1 = q('select now()')
            await st.goto(f'{S.base}/tickets/{tid}')
            check('keys removed: ticket page shows the backup code', await st.locator('text=QR code can’t be shown right now').count() == 1)
            wait = 30 if QUICK else 120
            await st.wait_for_timeout(wait * 1000)
            rows = int(q(f"select count(*) from app_errors where at >= '{t1}'") or 0)
            note(f'keys removed: one ticket page open {wait}s wrote {rows} app_errors rows (~{rows * 60 // wait}/min per open phone)')
            check('keys removed: page still shows the code after polling', await st.locator('.ticket-code').count() == 1)
        finally:
            S.stop()
        await b.close()

    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} extra production checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

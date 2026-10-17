# Production-readiness fix round 1 (2026-10-17). Own servers on :3005. Local Postgres only.
#   A. Production detection fails SAFE (no APP_ENV/VERCEL_ENV + non-local DB = production; VERCEL_ENV=preview stays preview)
#      and health names DEMO_PAYMENTS_IN_PRODUCTION / GATEWAY_TEST_KEYS_IN_PRODUCTION / CASHFREE_ENV with 503
#   B. Database setup check: missing tables/columns → 503 "database setup incomplete: …" (list checked against db/schema.sql);
#      login and scanner unlock still work without login_attempts (throttle fails open, error logged)
#   C. Login throttle per email + IP: a stranger's wrong passwords don't lock the volunteer out on another network;
#      looser per-email cap still applies
#   D. Error log: same error repeated → one row with a count; pruned to 30 days / 5,000 rows; ticket page auto-refresh
#      with broken keys stays one row
#   E. /setup/keys with keys set: can make a pair for another environment, never shows the current keys, sends nothing
#   F. 390px side margins on admin / sponsor / organizer pages (.page no longer overrides .wrap's gutter)
#   G. .env.example is safe to paste into Vercel; the guide is honest about backups, Resend and the preview database
import asyncio, json, os, re, signal, subprocess, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg_tls_proxy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
PORT = 3005
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)

BASE_ENV = {'DEMO_PAYMENTS': '', 'E2E_ERROR_ROUTE': '', 'ADMIN_EMAILS': '', 'APP_ENV': '', 'VERCEL_ENV': '', 'NEXT_PUBLIC_SITE_URL': '',
            'CASHFREE_APP_ID': '', 'CASHFREE_SECRET_KEY': '', 'CASHFREE_ENV': '', 'RAZORPAY_KEY_ID': '', 'RAZORPAY_KEY_SECRET': '',
            'RAZORPAY_WEBHOOK_SECRET': '', 'RESEND_API_KEY': '', 'PAYMENT_GATEWAY': ''}

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

def health(base):
    s, body = http(base, '/api/health')
    try: j = json.loads(body)
    except Exception: j = {}
    return s, j, body

async def login(b, base, email, url='/login', pw='password123', ip=None, ctx_opts=MOBILE):
    opts = dict(ctx_opts)
    if ip: opts['extra_http_headers'] = {'x-forwarded-for': f'{ip}, 10.0.0.1'}
    pg = await (await b.new_context(**opts)).new_page()
    await pg.goto(base + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)
    return pg

async def alert_text(pg):
    a = pg.locator('.alert')
    return ' '.join(await a.all_text_contents()) if await a.count() else ''

def schema_items():
    """Tables and later-added columns, straight from db/schema.sql."""
    src = open(os.path.join(ROOT, 'db/schema.sql')).read()
    tables = re.findall(r'^create table if not exists (\w+)', src, re.M)
    cols = [f'{t}.{c}' for t, c in re.findall(r'^alter table (\w+) add column if not exists (\w+)', src, re.M)]
    return tables, list(dict.fromkeys(cols))

async def main():
    os.makedirs(E2E, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── A. Production detection fails safe ──
        tls = pg_tls_proxy.start(6543)
        REMOTE = 'postgres://postgres@vm:6543/thefest'
        try:
            S = Server(DATABASE_URL=REMOTE, NEXT_PUBLIC_SITE_URL='https://thefest.example', DEMO_PAYMENTS='1')
            try:
                s, j, body = health(S.base)
                probs = j.get('problems', [])
                check('no APP_ENV/VERCEL_ENV + remote DB: treated as production (production-only checks run)', 'RESEND_API_KEY' in probs and 'ADMIN_EMAILS' in probs, body)
                check('production + DEMO_PAYMENTS=1: health 503 names DEMO_PAYMENTS_IN_PRODUCTION', s == 503 and 'DEMO_PAYMENTS_IN_PRODUCTION' in probs, body)
            finally:
                S.stop()
            S = Server(DATABASE_URL=REMOTE, VERCEL_ENV='preview', VERCEL_BRANCH_URL='x-git-full-app.vercel.app', DEMO_PAYMENTS='1')
            try:
                s, j, body = health(S.base)
                check('VERCEL_ENV=preview explicitly: stays preview (no production-only problems)', 'RESEND_API_KEY' not in j.get('problems', []) and 'DEMO_PAYMENTS_IN_PRODUCTION' not in body, body)
            finally:
                S.stop()
            S = Server(DATABASE_URL=REMOTE, VERCEL_ENV='Production ')
            try:
                s, j, body = health(S.base)
                check('VERCEL_ENV="Production " (case/space) still counts as production', 'RESEND_API_KEY' in j.get('problems', []), body)
            finally:
                S.stop()
        finally:
            tls.close()
        # Unix-socket database URL = local = development (postgres.js can't open these URLs, so only the
        # classification is checked: no production-only problems are listed)
        S = Server(DATABASE_URL='postgres:///thefest?host=/tmp')
        try:
            s, j, body = health(S.base)
            check('unix-socket database URL counts as local (not production)', 'RESEND_API_KEY' not in j.get('problems', []) and 'DEMO' not in body, body)
        finally:
            S.stop()
        # Cashfree: keys and CASHFREE_ENV read the same trimmed way everywhere; TEST keys detected
        for label, env, want in [
            ('CASHFREE_ENV=" Production\\n" + TEST app id', dict(CASHFREE_APP_ID='TEST99fake', CASHFREE_SECRET_KEY='cfsk_ma_prod_x', CASHFREE_ENV=' Production\n'), 'GATEWAY_TEST_KEYS_IN_PRODUCTION'),
            ('CASHFREE_ENV=production + _test_ secret', dict(CASHFREE_APP_ID='12345live', CASHFREE_SECRET_KEY='cfsk_ma_test_x', CASHFREE_ENV='production'), 'GATEWAY_TEST_KEYS_IN_PRODUCTION'),
            ('live-looking keys + CASHFREE_ENV=sandbox', dict(CASHFREE_APP_ID='12345live', CASHFREE_SECRET_KEY='cfsk_ma_prod_x', CASHFREE_ENV='sandbox'), 'CASHFREE_ENV'),
            ('Razorpay key " rzp_test_x"', dict(RAZORPAY_KEY_ID=' rzp_test_x', RAZORPAY_KEY_SECRET='s'), 'GATEWAY_TEST_KEYS_IN_PRODUCTION'),
        ]:
            S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', **env)
            try:
                s, j, body = health(S.base)
                check(f'production + {label}: 503 naming {want}', s == 503 and want in j.get('problems', []), body)
                check(f'production + {label}: no key values in health', 'cfsk' not in body and 'rzp_' not in body and 'TEST99' not in body)
            finally:
                S.stop()
        S = Server(APP_ENV='production', NEXT_PUBLIC_SITE_URL='https://thefest.example', CASHFREE_APP_ID='12345live', CASHFREE_SECRET_KEY='cfsk_ma_prod_x', CASHFREE_ENV=' production ')
        try:
            s, j, body = health(S.base)
            check('production + live keys + CASHFREE_ENV=" production ": gateway counted live (no gateway problem, no NO_LIVE_GATEWAY)',
                  not any(x in body for x in ['GATEWAY_TEST_KEYS', '"CASHFREE_ENV"', 'NO_LIVE_GATEWAY']), body)
        finally:
            S.stop()

        # ── B. Database setup check ──
        tables, cols = schema_items()
        sh('dropdb -h /tmp -U postgres --if-exists thefest_fx && createdb -h /tmp -U postgres thefest_fx')
        S = Server(DATABASE_URL='postgres://postgres@localhost:5432/thefest_fx')
        try:
            s, j, body = health(S.base)
            msg = next((x for x in j.get('problems', []) if x.startswith('database setup incomplete: ')), '')
            listed = msg.replace('database setup incomplete: ', '').split(', ') if msg else []
            check('empty database: 503 "database setup incomplete" listing every table in db/schema.sql',
                  s == 503 and sorted(listed) == sorted(tables), (s, sorted(set(tables) ^ set(listed))))
        finally:
            S.stop()
        sh(f'DATABASE_URL=postgres://postgres@localhost:5432/thefest_fx node {ROOT}/scripts/db-setup.mjs')
        for c in cols:
            t, col = c.split('.')
            q(f'alter table {t} drop column if exists {col} cascade', 'psql -h /tmp -U postgres thefest_fx')
        S = Server(DATABASE_URL='postgres://postgres@localhost:5432/thefest_fx')
        try:
            s, j, body = health(S.base)
            msg = next((x for x in j.get('problems', []) if x.startswith('database setup incomplete: ')), '')
            listed = msg.replace('database setup incomplete: ', '').split(', ') if msg else []
            check('every later-added column in db/schema.sql is checked (dropped → listed as table.column)',
                  s == 503 and sorted(listed) == sorted(cols), sorted(set(cols) ^ set(listed)))
        finally:
            S.stop()
        sh('dropdb -h /tmp -U postgres --if-exists thefest_fx')

        # Missing login_attempts: health names it, login and scanner unlock still work
        sh('dropdb -h /tmp -U postgres --if-exists thefest_old && createdb -h /tmp -U postgres thefest_old && '
           'pg_dump -h /tmp -U postgres thefest | psql -q -h /tmp -U postgres thefest_old >/dev/null 2>&1')
        OLD = 'psql -h /tmp -U postgres thefest_old'
        q('drop table login_attempts', OLD)
        S = Server(DATABASE_URL='postgres://postgres@localhost:5432/thefest_old')
        try:
            s, j, body = health(S.base)
            check('missing login_attempts: 503 "database setup incomplete: login_attempts"', s == 503 and 'database setup incomplete: login_attempts' in j.get('problems', []), body)
            pg = await login(b, S.base, 'student@thefest.in')
            check('missing login_attempts: student can still log in', pg.url.endswith('/fests'), (pg.url, await alert_text(pg)))
            pg = await login(b, S.base, 'student@thefest.in', pw='wrong-password')
            check('missing login_attempts: wrong password is a plain "Wrong email or password"', 'Wrong email or password' in await alert_text(pg), await alert_text(pg))
            pg = await login(b, S.base, 'volunteer@thefest.in', url='/scan/login')
            check('missing login_attempts: volunteer can still unlock the scanner', re.search(r'/scan/?$', pg.url) is not None, (pg.url, await alert_text(pg)))
            check('missing login_attempts: the failure is logged to app_errors',
                  q("select count(*) from app_errors where where_ like 'login throttle%'", OLD) not in ('', '0'))
        finally:
            S.stop()
        sh('dropdb -h /tmp -U postgres --if-exists thefest_old')

        # ── C. Throttle per email + IP ──
        q("delete from login_attempts where key like '%volunteer@thefest.in%'")
        S = Server()
        try:
            for i in range(10):
                await (await login(b, S.base, 'volunteer@thefest.in', url='/scan/login', pw=f'bad{i}', ip='203.0.113.66')).context.close()
            pg = await login(b, S.base, 'volunteer@thefest.in', url='/scan/login', ip='203.0.113.66')
            check('10 wrong passwords from one network: that network is blocked', 'Too many attempts' in await alert_text(pg), (pg.url, await alert_text(pg)))
            pg = await login(b, S.base, 'volunteer@thefest.in', url='/scan/login', ip='198.51.100.23')
            check('the volunteer on another network still unlocks the scanner', re.search(r'/scan/?$', pg.url) is not None, (pg.url, await alert_text(pg)))
            pg = await login(b, S.base, 'volunteer@thefest.in', ip='198.51.100.24', pw='nope')
            check('x-forwarded-for first address is used (a third network is not blocked: plain wrong-password)', 'Wrong email or password' in await alert_text(pg), await alert_text(pg))
            # looser per-email cap (50 in 15 minutes) still applies from anywhere
            q("insert into login_attempts (key, fails, window_start) values ('e:volunteer@thefest.in', 50, now()) on conflict (key) do update set fails = 50, window_start = now()")
            pg = await login(b, S.base, 'volunteer@thefest.in', url='/scan/login', ip='192.0.2.200')
            check('per-email cap (50 fails / 15 min) blocks from every network', 'Too many attempts' in await alert_text(pg), (pg.url, await alert_text(pg)))
            n = q("select count(*) from login_attempts where key like 'ip:volunteer@thefest.in|%'")
            check('per-network rows are keyed email + IP', n not in ('', '0'), n)
        finally:
            S.stop()
            q("delete from login_attempts where key like '%volunteer@thefest.in%'")

        # ── D. Error log de-duplication and pruning ──
        S = Server(E2E_ERROR_ROUTE='1', ADMIN_EMAILS='admin@thefest.in')
        try:
            q("update app_errors set at = at - interval '10 minutes' where where_ like '%test-error%'")
            t0 = q('select now()'); rows0 = int(q('select count(*) from app_errors'))
            for _ in range(20): http(S.base, '/api/test-error')
            await asyncio.sleep(1)
            row = q(f"select count(*) || ' ' || coalesce(sum(repeats), 0) from app_errors where at >= '{t0}' and where_ like '%test-error%'").split()
            check('20 identical errors in a row → ONE row counted 20 times', row == ['1', '20'], row)
            check('…and the table grew by one row', int(q('select count(*) from app_errors')) - rows0 == 1)
            # pruning: 40-day-old rows go; never more than 5,000 rows
            q("insert into app_errors (at, where_, message) select now() - interval '40 days', 'old ' || g, 'old error ' || g from generate_series(1, 50) g")
            q("insert into app_errors (at, where_, message) select now() - interval '1 hour', 'bulk ' || g, 'bulk error ' || g from generate_series(1, 5100) g")
            q("update app_errors set at = at - interval '10 minutes' where where_ like '%test-error%' and at > now() - interval '10 minutes'")
            q("select setval('app_errors_id_seq', ((select max(id) from app_errors) / 50 + 1) * 50 - 1)")
            http(S.base, '/api/test-error'); await asyncio.sleep(1)
            left = q("select count(*) || ' ' || count(*) filter (where at < now() - interval '30 days') from app_errors").split()
            check('every 50th new error prunes: ≤ 5,000 rows and nothing older than 30 days', int(left[0]) <= 5000 and left[1] == '0', left)
            check('the newest error survives pruning', q("select count(*) from app_errors where where_ like '%test-error%' and at > now() - interval '1 minute'") == '1')
            q("delete from app_errors where where_ like 'bulk %' or where_ like 'old %'")
            http(S.base, '/api/test-error'); http(S.base, '/api/test-error'); await asyncio.sleep(0.5)
            adm = await login(b, S.base, 'admin@thefest.in')
            await adm.goto(S.base + '/admin/errors')
            check('/admin/errors shows the repeat count', await adm.locator('text=/\\d+ times, last/').count() >= 1)
        finally:
            S.stop()
        # Ticket page left open with broken keys: auto-refresh every 15 s stays ONE row
        tid = q("select t.id from tickets t join users u on u.id=t.user_id where u.email='student@thefest.in' and t.status='valid' limit 1")
        q("update app_errors set at = at - interval '10 minutes' where where_ = 'ticket QR'")
        S = Server(TICKET_PRIVATE_KEY='', TICKET_PUBLIC_KEY='')
        try:
            st = await login(b, S.base, 'student@thefest.in'); t1 = q('select now()')
            await st.goto(f'{S.base}/tickets/{tid}'); await st.wait_for_timeout(35000)
            row = q(f"select count(*) || ' ' || coalesce(max(repeats), 0) from app_errors where at >= '{t1}' and where_ = 'ticket QR'").split()
            check('ticket page with broken keys, open 35 s (≥ 3 refreshes): one error row, repeats counted', row[0] == '1' and int(row[1]) >= 3, row)
        finally:
            S.stop()

        # ── E. /setup/keys with keys set ──
        S = Server()
        try:
            server_pub = [l for l in open(os.path.join(ROOT, '.env.local')) if l.startswith('TICKET_PUBLIC_KEY=')]
            pub_body = server_pub[0].split('\\n')[1][:40] if server_pub and '\\n' in server_pub[0] else None
            pg = await (await b.new_context(**MOBILE)).new_page(); sent = []
            pg.on('request', lambda r: sent.append(r.method + ' ' + r.url + ' ' + (r.post_data or '')))
            await pg.goto(S.base + '/setup/keys'); await pg.wait_for_load_state('networkidle')
            check('/setup/keys (keys set): says keys are already set, no keys shown', await pg.locator('text=Keys are already set').count() == 1 and await pg.locator('textarea').count() == 0)
            html = await pg.content()
            check('/setup/keys never shows the current public or private key', 'BEGIN' not in html and (pub_body is None or pub_body not in html))
            await pg.click('summary:has-text("another environment")')
            await pg.click('button:has-text("Make a pair for another environment")')
            await pg.wait_for_selector('textarea[aria-label=TICKET_PRIVATE_KEY]')
            priv = await pg.locator('textarea[aria-label=TICKET_PRIVATE_KEY]').input_value()
            pub = await pg.locator('textarea[aria-label=TICKET_PUBLIC_KEY]').input_value()
            check('/setup/keys (keys set): makes a fresh pair for another environment', priv.startswith('-----BEGIN PRIVATE KEY-----\\n') and pub.startswith('-----BEGIN PUBLIC KEY-----\\n') and (pub_body is None or pub_body not in pub))
            await pg.click('button:has-text("Make a different pair")'); await pg.wait_for_timeout(500)
            body_part = priv.split('\\n')[1][:30]
            check('/setup/keys (keys set): no request carries the new private key, no POST', not any(body_part in s for s in sent) and not any(s.startswith('POST') for s in sent), len(sent))
            check('/setup/keys (keys set) fits 390px', await pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
            await pg.screenshot(path=f'{E2E}/setup_keys_other_env_390.png', full_page=True)
        finally:
            S.stop()

        # ── F. 390px side margins ──
        S = Server(ADMIN_EMAILS='admin@thefest.in')
        try:
            async def left_edge(pg, sel=None):
                # left edge of the first visible text inside <main>
                return await pg.evaluate('''() => { const m = document.querySelector('main'); if (!m) return -1;
                  const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT); let n;
                  while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
                    const b = r.getBoundingClientRect(); if (b.width > 0 && b.height > 0) return b.left; }
                  return -1; }''')
            adm = await login(b, S.base, 'admin@thefest.in')
            for path in ['/admin', '/admin/errors', '/admin/fests', '/admin/orders']:
                await adm.goto(S.base + path)
                x = await left_edge(adm, 'main h1, main h2')
                check(f'390px {path}: heading has a side margin (≥ 12px)', x >= 12, x)
            await adm.screenshot(path=f'{E2E}/admin_orders_margin_390.png')
            sp = await login(b, S.base, 'sponsor@thefest.in')
            await sp.goto(S.base + '/sponsor'); x = await left_edge(sp, 'main h1, main h2')
            check('390px /sponsor: heading has a side margin', x >= 12, x)
            org = await login(b, S.base, 'organizer2@thefest.in')
            await org.goto(S.base + '/organizer'); x = await left_edge(org, 'main h1, main h2')
            check('390px /organizer (fest list): heading has a side margin', x >= 12, x)
            st = await login(b, S.base, 'student@thefest.in')
            for path in ['/fests', '/tickets', '/me']:
                await st.goto(S.base + path); x = await left_edge(st, 'main h1, main .h1, main h2, main .h2')
                wide = await st.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                check(f'390px {path} (student): still has its margin and no sideways scroll', 12 <= x < 60 and wide, x)
        finally:
            S.stop()
        await b.close()

    # ── G. .env.example and the guide ──
    env = {}
    for line in open(os.path.join(ROOT, '.env.example')):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m: env[m.group(1)] = m.group(2)
    check('.env.example: no active DEMO_PAYMENTS or APP_ENV line', 'DEMO_PAYMENTS' not in env and 'APP_ENV' not in env, {k: env.get(k) for k in ('DEMO_PAYMENTS', 'APP_ENV')})
    check('.env.example: CASHFREE_ENV not set to sandbox (only in a comment)', env.get('CASHFREE_ENV', '') == '', env.get('CASHFREE_ENV'))
    check('.env.example: NEXT_PUBLIC_SITE_URL and ADMIN_EMAILS empty', env.get('NEXT_PUBLIC_SITE_URL') == '' and env.get('ADMIN_EMAILS') == '', (env.get('NEXT_PUBLIC_SITE_URL'), env.get('ADMIN_EMAILS')))
    guide = open(os.path.join(ROOT, 'docs/LAUNCH-CHECKLIST.md')).read()
    check('guide: backups not running until the workflow is on the default branch, three options listed',
          'default branch' in guide and 'NOT running yet' in guide and 'Supabase Pro' in guide and 'Default branch' in guide)
    check('guide: verify thefest.in in Resend before email steps', 'Verify thefest.in first' in guide and 'Needs the verified domain' in guide)
    check('guide: previews use a separate database, never production', 'separate preview database' in guide and 'never the production one' in guide)
    check('guide: make the preview and production key pairs in one sitting', 'in one sitting' in guide)
    check('guide: Part 2a SQL adds app_errors.repeats', 'add column if not exists repeats' in guide)

    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} fix-round-1 checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

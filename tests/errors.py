# Errors log + alerts, admin System card, health, headers, keys page, ticket-page polling.
# Runs against the main release-check server on :3000 (DEMO_PAYMENTS=1, E2E_ERROR_ROUTE=1, ADMIN_EMAILS=admin@thefest.in).
import asyncio, os, re, subprocess, sys, urllib.request, urllib.error, json
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def get(path):
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + path), timeout=20)
        return r.status, r.headers, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)

async def login(b, email, ctx_opts=MOBILE, clock=False):
    ctx = await b.new_context(**ctx_opts); pg = await ctx.new_page()
    if clock: await pg.clock.install()
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def no_sideways(pg):
    return await pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

async def main():
    # ── Health (criterion 7) ──
    st, h, body = get('/api/health')
    j = json.loads(body)
    check('health: 200 ok with db up', st == 200 and j.get('status') == 'ok' and j.get('db') == 'up', body)
    check('health: Cache-Control no-store', 'no-store' in h.get('Cache-Control', ''), h.get('Cache-Control'))
    check('health: no gateway or email mode in public output', 'payments' not in j and 'email' not in j and 'signing' not in j, body)

    # ── Headers (criterion 21) and old prototype link ──
    st, h, _ = get('/')
    check('CSP has frame-ancestors self', "frame-ancestors 'self'" in h.get('Content-Security-Policy', ''), h.get('Content-Security-Policy'))
    check('nosniff, Referrer-Policy and Permissions-Policy kept',
          h.get('X-Content-Type-Options') == 'nosniff' and h.get('Referrer-Policy') and 'camera=(self)' in h.get('Permissions-Policy', ''))
    try:
        urllib.request.build_opener(NoRedirect).open(B + '/index.html', timeout=10); loc = None; code = 200
    except urllib.error.HTTPError as e:
        code, loc = e.code, e.headers.get('Location')
    check('/index.html redirects to /', code in (301, 308) and loc in ('/', B + '/'), (code, loc))

    # ── Errors log + alert (criterion 17) ──
    q('delete from app_alert_state')
    before = int(q('select count(*) from app_errors'))
    alerts_before = int(q("select count(*) from email_outbox where to_email='admin@thefest.in' and subject like '%new error%'"))
    s1, _, _ = get('/api/test-error'); s2, _, _ = get('/api/test-error')
    check('test error route returns 500', s1 == 500 and s2 == 500, (s1, s2))
    await asyncio.sleep(1.5)
    after = int(q('select count(*) from app_errors'))
    check('both errors stored in app_errors', after - before >= 2, (before, after))
    check('error row says where it happened', q("select count(*) from app_errors where where_ like '%test-error%' and message like '%Test error from the release check%'") != '0')
    alerts = int(q("select count(*) from email_outbox where to_email='admin@thefest.in' and subject like '%new error%'")) - alerts_before
    check('two errors within 15 minutes → exactly one alert email', alerts == 1, alerts)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        adm = await login(b, 'admin@thefest.in')
        await adm.goto(B + '/admin/errors')
        check('admin sees the error on /admin/errors', await adm.locator('text=Test error from the release check').count() >= 1)
        check('/admin/errors fits 390px (no sideways scroll)', await no_sideways(adm))
        await adm.screenshot(path='/tmp/thefest-e2e/admin_errors_390.png', full_page=True)
        await adm.goto(B + '/admin')
        card = adm.locator('section[aria-label=System]')
        txt = (await card.text_content()) or ''
        check('admin System card shows gateway, email, signing keys, environment',
              await card.count() == 1 and 'demo' in txt and 'not configured' in txt and 'Ticket signing keys' in txt and 'OK' in txt and 'development' in txt, txt[:200])
        check('admin overview fits 390px', await no_sideways(adm))

        for who in ('student@thefest.in', 'organizer@thefest.in'):
            pg = await login(b, who)
            await pg.goto(B + '/admin/errors')
            check(f'{who.split("@")[0]} redirected away from /admin/errors', '/admin' not in pg.url, pg.url)
            await pg.goto(B + '/admin')
            check(f'{who.split("@")[0]} never sees the System card', await pg.locator('section[aria-label=System]').count() == 0 and '/admin' not in pg.url)

        # ── Keys page with valid keys set (criterion 20, last part) ──
        anon = await (await b.new_context(**MOBILE)).new_page()
        await anon.goto(B + '/setup/keys')
        check('/setup/keys says keys already set when valid', await anon.locator('text=Keys are already set').count() == 1 and await anon.locator('textarea').count() == 0)

        # ── Ticket page polling: ≥15 s, stops after 10 min with "Tap to refresh" (criterion 16) ──
        st = await login(b, 'student@thefest.in', clock=True)
        tid = q("select t.id from tickets t join users u on u.id=t.user_id where u.email='student@thefest.in' and t.status='valid' limit 1")
        refreshes = []
        st.on('request', lambda r: r.headers.get('rsc') == '1' and f'/tickets/{tid}' in r.url and refreshes.append((r.url, r.headers.get('next-router-prefetch'))))
        await st.goto(f'{B}/tickets/{tid}'); await st.wait_for_load_state('networkidle')
        refreshes.clear()
        await st.clock.run_for(60000); await st.wait_for_timeout(2000)
        # every 15 s → 4 refreshes a minute (the old 8 s would be 7); allow one extra for real time passing
        check('ticket page refreshes about every 15 s (never faster)', 3 <= len(refreshes) <= 5, len(refreshes))
        check('no "Tap to refresh" while polling', await st.locator('text=Tap to refresh').count() == 0)
        await st.clock.fast_forward(10 * 60 * 1000); await st.clock.run_for(16000); await st.wait_for_timeout(800)
        check('after 10 minutes polling stops and "Tap to refresh" appears', await st.locator('text=Tap to refresh').count() == 1)
        refreshes.clear()
        await st.clock.run_for(60000); await st.wait_for_timeout(800)
        check('no more refreshes after it stopped', len(refreshes) == 0, len(refreshes))
        await st.click('text=Tap to refresh'); await st.wait_for_timeout(1500)
        check('tapping refreshes the page', len(refreshes) >= 1 and await st.locator('text=Tap to refresh').count() == 0)
        await b.close()

    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} error/admin/health checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

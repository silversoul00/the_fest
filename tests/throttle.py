# Fix round 2 (2026-10-17): login throttle counts FIRST, so parallel bursts can't overshoot.
# Uses the release-check server on :3000 and the local database. Local Postgres only.
#   1. 40 parallel wrong-password posts to /login (one account, one network) → at most 10 reach the password check,
#      the counters stop at the limit, and the RIGHT password is refused once locked
#   2. Same burst on the gate scanner login (/scan/login)
#   3. Per-email cap: 70 parallel posts each from a different network → at most 50 reach the password check,
#      and the "on this account" message says switching network won't help
#   4. Admin "Unlock a login" on /admin clears the lockout (only for admins), and the volunteer gets in straight away
import asyncio, os, subprocess, threading, urllib.request, urllib.error
from playwright.async_api import async_playwright

BASE = os.environ.get('E2E_BASE', 'http://localhost:3000')
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
LIMIT_IP, LIMIT_EMAIL = 10, 50
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def counts(email): return q(f"select string_agg(key || '=' || fails, ',' order by key) from login_attempts where key like '%{email}%'")

async def capture(b, url, email, pw):
    """Submit the login form once in a real browser; return the server-action request so it can be replayed."""
    cap = {}
    ctx = await b.new_context(**MOBILE); pg = await ctx.new_page()
    def on_req(r):
        if r.method == 'POST' and 'next-action' in {k.lower() for k in r.headers}:
            cap['h'] = r.headers; cap['d'] = r.post_data_buffer
    pg.on('request', on_req)
    await pg.goto(BASE + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)
    await ctx.close()
    h = {k: v for k, v in cap['h'].items() if k.lower() in ('next-action', 'content-type', 'accept', 'next-router-state-tree')}
    h['Origin'] = BASE
    return url, h, cap['d']

def burst(req, n, ips=None):
    url, h, data = req
    res = [None] * n
    def fire(i):
        hh = dict(h)
        if ips: hh['x-forwarded-for'] = ips[i]
        try: res[i] = urllib.request.urlopen(urllib.request.Request(BASE + url, data=data, headers=hh, method='POST'), timeout=90).read().decode()
        except Exception as e: res[i] = 'ERR ' + str(e)
    ts = [threading.Thread(target=fire, args=(i,)) for i in range(n)]
    [t.start() for t in ts]; [t.join() for t in ts]
    return sum('Wrong email or password' in r for r in res), sum('Too many attempts' in r for r in res), res

async def try_login(b, url, email, pw='password123', ip=None):
    opts = dict(MOBILE)
    if ip: opts['extra_http_headers'] = {'x-forwarded-for': ip}
    pg = await (await b.new_context(**opts)).new_page()
    await pg.goto(BASE + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)
    a = pg.locator('.alert')
    return pg, (' '.join(await a.all_text_contents()) if await a.count() else '')

async def main():
    os.makedirs(E2E, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        try:
            # ── 1. App login burst ──
            q("delete from login_attempts where key like '%sponsor@thefest.in%'")
            req = await capture(b, '/login', 'sponsor@thefest.in', 'wrong-0')   # attempt 1
            wrong, many, res = burst(req, 40)
            checked = wrong + 1
            check(f'/login: 40 parallel wrong passwords → at most {LIMIT_IP} reach the password check', checked <= LIMIT_IP, (checked, many, counts('sponsor@thefest.in')))
            check('/login: every other attempt is refused with "Too many attempts"', wrong + many == 40, [r[-200:] for r in res if 'Wrong' not in r and 'Too many' not in r][:2])
            check(f'/login: per-account count stops at {LIMIT_IP} (blocked attempts are not added to it)',
                  q("select fails from login_attempts where key = 'e:sponsor@thefest.in'") == str(LIMIT_IP), counts('sponsor@thefest.in'))
            _, msg = await try_login(b, '/login', 'sponsor@thefest.in')
            check('/login: once locked, the RIGHT password is refused too', 'Too many attempts' in msg, msg)
            q("delete from login_attempts where key like '%sponsor@thefest.in%'")
            pg, msg = await try_login(b, '/login', 'sponsor@thefest.in')
            check('/login: after the lock is cleared the right password works and clears the count',
                  pg.url.endswith('/sponsor') and counts('sponsor@thefest.in') == '', (pg.url, msg, counts('sponsor@thefest.in')))

            # ── 2. Scanner login burst ──
            q("delete from login_attempts where key like '%volunteer@thefest.in%'")
            req = await capture(b, '/scan/login', 'volunteer@thefest.in', 'wrong-0')
            wrong, many, _ = burst(req, 40)
            check(f'/scan/login: 40 parallel wrong passwords → at most {LIMIT_IP} reach the password check', wrong + 1 <= LIMIT_IP and wrong + many == 40, (wrong + 1, many))
            _, msg = await try_login(b, '/scan/login', 'volunteer@thefest.in')
            check('/scan/login: once locked, the RIGHT password is refused', 'Too many attempts' in msg, msg)

            # ── 3. Per-email cap across many networks ──
            q("delete from login_attempts where key like '%volunteer@thefest.in%'")
            ips = [f'198.51.100.{i + 1}, 10.0.0.1' for i in range(70)]
            wrong, many, _ = burst(req, 70, ips)
            check(f'70 parallel wrong passwords from 70 networks → at most {LIMIT_EMAIL} reach the password check', wrong <= LIMIT_EMAIL and wrong + many == 70, (wrong, many))
            _, msg = await try_login(b, '/scan/login', 'volunteer@thefest.in', ip='192.0.2.77')
            check('per-email cap: a brand-new network is refused with the "on this account" message',
                  'Too many attempts on this account' in msg and 'switching network won’t help' in msg, msg)

            # ── 4. Admin unlock ──
            pg, _ = await try_login(b, '/login', 'organizer@thefest.in')
            await pg.goto(BASE + '/admin'); await pg.wait_for_load_state('networkidle')
            check('non-admin does not see "Unlock a login"', await pg.locator('section[aria-label="Unlock a login"]').count() == 0, pg.url)
            pg, _ = await try_login(b, '/login', 'admin@thefest.in')
            await pg.goto(BASE + '/admin'); await pg.wait_for_load_state('networkidle')
            box = pg.locator('section[aria-label="Unlock a login"]')
            check('/admin shows "Unlock a login"', await box.count() == 1)
            check('/admin: no sideways scroll at 390px', await pg.evaluate('document.documentElement.scrollWidth <= Math.min(window.innerWidth, screen.width) + 1'))
            await box.locator('input[name=email]').fill('Volunteer@TheFest.in ')
            await box.locator('button[type=submit]').click(); await pg.wait_for_timeout(1500)
            text = await box.inner_text()
            check('admin unlock: confirms "Unlocked volunteer@thefest.in"', 'Unlocked volunteer@thefest.in' in text, text)
            check('admin unlock: every count for that email is gone (all networks)', counts('volunteer@thefest.in') == '', counts('volunteer@thefest.in'))
            await box.screenshot(path=f'{E2E}/admin_unlock_390.png')
            await box.locator('input[name=email]').fill('volunteer@thefest.in'); await box.locator('button[type=submit]').click(); await pg.wait_for_timeout(1500)
            check('admin unlock again: says it wasn’t locked out', 'wasn’t locked out' in await box.inner_text(), await box.inner_text())
            pg, msg = await try_login(b, '/scan/login', 'volunteer@thefest.in', ip='192.0.2.77')
            check('after unlock the volunteer opens the scanner straight away', pg.url.rstrip('/').endswith('/scan'), (pg.url, msg))
        finally:
            q("delete from login_attempts where key like '%sponsor@thefest.in%' or key like '%volunteer@thefest.in%'")
            await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit('FAILED: ' + '; '.join(failed))

asyncio.run(main())

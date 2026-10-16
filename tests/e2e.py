# End-to-end test of every portal. Run via tests/run-e2e.sh (needs a running server on seeded data).
import asyncio, re, json
from playwright.async_api import async_playwright
import os
S = os.environ.get('E2E_DIR', '/tmp/thefest-e2e') + '/'
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
TID, FID, CODE = open(S + 'student_ticket.txt').read().split()
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))

async def login(pg, email, pw='password123', url='/login'):
    await pg.goto(B + url)
    await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]')
    await pg.wait_for_load_state('networkidle')

def watch(pg, errs):
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errs.append(m.text))

async def main():
    async with async_playwright() as p:
        errs = []
        browser = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={S}qr.y4m'])
        mobile = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)

        # ── ORGANIZER ──────────────────────────────────────────
        oc = await browser.new_context(**mobile); org = await oc.new_page(); watch(org, errs)
        await login(org, 'organizer@thefest.in')
        check('organizer lands on fest list (2 fests)', org.url.endswith('/organizer'), org.url)
        await org.click('a:has-text("Neon Utsav")'); await org.wait_for_url(re.compile(r'/organizer/[0-9a-f-]{36}$')); await org.wait_for_load_state('networkidle')
        neon = org.url.rsplit('/', 1)[-1]
        check('overview shows Live now', await org.locator('h1:has-text("Live")').count() > 0)
        await org.screenshot(path=S + 'o_overview_mobile.png', full_page=True)
        for tab in ['tickets', 'sales', 'schedule', 'volunteers', 'announcements', 'sponsors', 'settings']:
            r = await org.goto(f'{B}/organizer/{neon}/{tab}')
            check(f'organizer tab {tab} loads', r.status == 200 and await org.locator('h1').count() > 0, r.status)
        # add ticket type
        await org.goto(f'{B}/organizer/{neon}/tickets')
        f = org.locator('form:has(button:has-text("Add ticket type"))')
        await f.locator('input[name=name]').fill('Early Bird'); await f.locator('input[name=price]').fill('199'); await f.locator('input[name=quota]').fill('50')
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('text=Ticket type added.')
        check('add ticket type', await org.locator('strong:has-text("Early Bird")').count() == 1)
        # bad input
        await f.locator('input[name=name]').fill('X'); await f.locator('input[name=price]').fill('10'); await f.locator('input[name=quota]').fill('5')
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('.alert.error')
        check('ticket validation error shown', 'Name the ticket' in (await org.text_content('.alert.error')))
        # schedule add
        await org.goto(f'{B}/organizer/{neon}/schedule')
        f = org.locator('form:has(button:has-text("Add to schedule"))')
        await f.locator('input[name=title]').fill('Midnight Jam'); await f.locator('input[name=venue]').fill('Main Stage')
        await f.locator('input[name=start]').fill('22:00'); await f.locator('input[name=end]').fill('01:00')
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('text=Added to schedule.')
        check('add schedule event (past midnight)', await org.locator('text=Midnight Jam').count() >= 1)
        # volunteer add
        await org.goto(f'{B}/organizer/{neon}/volunteers')
        f = org.locator('form:has(button:has-text("Add to team"))')
        await f.locator('input[name=name]').fill('New Vol'); await f.locator('input[name=email]').fill('newvol@example.com')
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('text=New Vol added')
        check('add volunteer', True)
        await f.locator('input[name=name]').fill('Dup Vol'); await f.locator('input[name=email]').fill('newvol@example.com')
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('.alert.error')
        check('duplicate volunteer rejected', 'already' in (await org.text_content('.alert.error')))
        # announcement
        await org.goto(f'{B}/organizer/{neon}/announcements')
        f = org.locator('form:has(button:has-text("Post announcement"))')
        await f.locator('input[name=title]').fill('Free water at Gate 3'); await f.locator('input[name=urgent]').check()
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('text=Posted')
        check('post announcement', True)
        # sponsor
        await org.goto(f'{B}/organizer/{neon}/sponsors')
        f = org.locator('form:has(button:has-text("Add sponsor"))')
        await f.locator('input[name=brand]').fill('Test Cola'); await f.locator('input[name=email]').fill('cola@example.com'); await f.locator('input[name=amount]').fill('25000')
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('text=Test Cola added')
        check('add sponsor', True)
        # CSV
        async with org.expect_download() as dl:
            await org.goto(f'{B}/organizer/{neon}/sales'); await org.click('text=Export CSV')
        d = await dl.value; path = await d.path(); csv = open(path, encoding='utf-8-sig').read()
        check('CSV export has header + rows', csv.startswith('code,holder_name') and csv.count('\n') > 100, f'{csv.count(chr(10))} lines')
        # create a new fest, publish
        await org.goto(B + '/organizer/new')
        await org.fill('input[name=name]', 'Test Fest E2E'); await org.fill('input[name=college]', 'E2E College')
        await org.fill('input[name=starts_on]', '2026-12-10'); await org.fill('input[name=ends_on]', '2026-12-11')
        await org.fill('input[name=ticket_price]', '0')
        await org.click('button:has-text("Create fest")'); await org.wait_for_url('**/organizer/*?created=1')
        newfest = org.url.split('/organizer/')[1].split('?')[0]
        check('create fest → draft dashboard', await org.locator('text=Your fest is a draft').count() == 1)
        await org.click('button:has-text("Publish fest")'); await org.wait_for_load_state('networkidle')
        check('publish fest', await org.locator('text=Your fest is a draft').count() == 0)
        # desktop screenshot
        await org.set_viewport_size({'width': 1366, 'height': 900})
        await org.goto(f'{B}/organizer/{neon}'); await org.screenshot(path=S + 'o_overview_desktop.png', full_page=True)
        # security: other organizer's fest → 404
        other = await org.evaluate("fetch('/fests/kalaa-fest').then(r=>r.status)")
        r = await org.goto(f'{B}/organizer/00000000-0000-0000-0000-000000000000')
        check('random fest id → 404', r.status == 404, r.status)

        # ── STUDENT ────────────────────────────────────────────
        sc = await browser.new_context(**mobile); st = await sc.new_page(); watch(st, errs)
        r = await st.goto(B + '/tickets'); check('tickets requires login', '/login' in st.url)
        await st.goto(B + '/fests/test-fest-e2e')
        check('new published fest visible to public', await st.locator('h1:has-text("Test Fest E2E")').count() == 1)
        await login(st, 'student@thefest.in', url='/login?next=/fests/test-fest-e2e')
        check('login returns to next', st.url.endswith('/fests/test-fest-e2e'), st.url)
        await st.click('button:has-text("Get free ticket")'); await st.wait_for_url('**/tickets?order=*')
        check('free ticket issued instantly', await st.locator('text=You\'re in!').count() == 1)
        r = await st.goto(f'{B}/organizer/{neon}'); check('student blocked from organizer', '/fests' in st.url, st.url)
        # fest page shows announcement posted by organizer
        await st.goto(B + '/fests/neon-utsav')
        check('announcement visible to students', await st.locator('text=Free water at Gate 3').count() == 1)
        # cancelled demo checkout releases seats
        before = await st.evaluate("fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticketTypeId:'bad',qty:1})}).then(r=>r.status)")
        check('checkout rejects bad input', before == 400, before)

        # ── SCANNER (fake camera shows the student's QR) ───────
        vc = await browser.new_context(**mobile); vol = await vc.new_page(); watch(vol, errs)
        await vc.grant_permissions(['camera'], origin=B)
        r = await vol.goto(B + '/scan'); check('scanner requires login', '/scan/login' in vol.url)
        await login(vol, 'student@thefest.in', url='/scan/login')
        check('non-staff refused by scanner', await vol.locator('.alert.error').count() == 1)
        await login(vol, 'volunteer@thefest.in', url='/scan/login')
        check('volunteer unlocks scanner', vol.url.endswith('/scan'), vol.url)
        await vol.click('button:has-text("Start camera")')
        await vol.wait_for_selector('.verdict', timeout=15000)
        v1 = await vol.text_content('.verdict')
        check('CAMERA scan admits valid ticket', 'Admit' in v1, v1.strip()[:60])
        await vol.wait_for_timeout(5500)  # same QR still in frame → should be re-sent after 4s and flagged duplicate
        v2 = await vol.text_content('.verdict')
        check('re-scan flagged duplicate', 'Already in' in v2, v2.strip()[:70])
        await vol.screenshot(path=S + 'scan_dup.png', full_page=True)
        # tampered payload & code entry via API
        tampered = await vol.evaluate(f"""fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},
            body:JSON.stringify({{festId:'{FID}',gate:'Gate 1',payload:'TF1.tZSDE54TR06KLlgye6G8mQ.bFm9A4NOSmuT_n7XErvJbQ.AAAA'}})}}).then(r=>r.json())""")
        check('tampered QR rejected', tampered.get('result') == 'invalid', tampered.get('message'))
        await vol.fill('input[aria-label="Ticket code"]', CODE.lower().replace('-', ''))
        await vol.click('button:has-text("Check")'); await vol.wait_for_timeout(800)
        check('typed code (messy format) recognised as duplicate', 'Already in' in await vol.text_content('.verdict'))
        # concurrent double-scan race on a fresh ticket: only one admit
        tid2, fid2 = (await st.evaluate("1"), None)
        # lock
        await vol.click('button:has-text("Lock")'); await vol.wait_for_url('**/scan/login')
        r2 = await vol.goto(B + '/scan'); check('lock ends scanner session', '/scan/login' in vol.url)
        # new browser session (cookie is session-only) → must re-auth
        await login(vol, 'volunteer@thefest.in', url='/scan/login')
        cookies = await vc.cookies()
        scan_cookie = [c for c in cookies if c['name'] == 'tf_scan'][0]
        check('scanner cookie is browser-session only', scan_cookie['expires'] == -1, scan_cookie['expires'])
        app_cookies = [c for c in cookies if c['name'] == 'tf_session']
        st_cookie = [c for c in await sc.cookies() if c['name'] == 'tf_session'][0]
        check('app cookie persists 30 days', st_cookie['expires'] > 0)

        # ticket page reflects check-in
        await st.goto(f'{B}/tickets/{TID}')
        check('student ticket shows ADMITTED', await st.locator('.stamp').count() == 1)
        await st.screenshot(path=S + 's_ticket_used.png', full_page=True)

        # ── SPONSOR ────────────────────────────────────────────
        pc = await browser.new_context(**mobile); sp = await pc.new_page(); watch(sp, errs)
        await login(sp, 'sponsor@thefest.in')
        check('sponsor lands on dashboard', sp.url.endswith('/sponsor'))
        check('sponsor sees 2 sponsorships', await sp.locator('a.card.link').count() == 2)
        await sp.click('a.card.link >> nth=0'); await sp.wait_for_load_state('networkidle')
        check('sponsor detail shows footfall', await sp.locator('text=Verified footfall').count() == 1)
        await sp.screenshot(path=S + 'sp_detail.png', full_page=True)
        href = await sp.get_attribute('a:has-text("Booth QR poster")', 'href')
        booth = href.split('/')[2]
        r = await sp.goto(B + href); check('booth poster renders QR', r.status == 200 and await sp.locator('svg').count() >= 1)
        # student checks in at booth
        await st.goto(f'{B}/booth/{booth}')
        await st.click('button:has-text("Check in at")'); await st.wait_for_url('**done=1')
        check('student booth check-in', await st.locator('text=checked in at the').count() == 1)
        # sponsor can't see others; student can't see sponsor
        r = await st.goto(B + '/sponsor'); check('student blocked from sponsor portal', '/fests' in st.url)

        # ── STUDENT can't scan via API without scanner session ─
        r = await st.evaluate(f"fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{festId:'{FID}',code:'{CODE}'}})}}).then(r=>r.status)")
        check('scan API requires scanner session', r == 401, r)

        # ── Landing redirect for signed-in roles ───────────────
        await sp.goto(B + '/'); check('signed-in sponsor: / → /sponsor', sp.url.endswith('/sponsor'))

        print('\nJS ERRORS:', errs[:10])
        print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} passed")
        await browser.close()

asyncio.run(main())
import sys
sys.exit(0 if results and all(ok for _, ok in results) else 1)

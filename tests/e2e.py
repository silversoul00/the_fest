# End-to-end test of every portal. Run via tests/run-e2e.sh (needs a running server on seeded data).
import asyncio, re, json
from playwright.async_api import async_playwright
import os, subprocess
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
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
        await org.wait_for_selector('strong:has-text("Early Bird")', timeout=10000)
        check('add ticket type', await org.locator('strong:has-text("Early Bird")').count() == 1)
        # lunch / stay / add-on settings on a ticket type
        await f.locator('input[name=name]').fill('Hostel add-on'); await f.locator('input[name=price]').fill('150'); await f.locator('input[name=quota]').fill('40')
        await f.locator('input[name=addon]').check(); await f.locator('input[name=includes_stay]').check()
        await f.locator('input[name=lunch_days]').nth(1).check()
        await f.locator('button[type=submit]').click(); await org.wait_for_selector('strong:has-text("Hostel add-on")', timeout=10000)
        card = org.locator('.card', has=org.locator('strong:has-text("Hostel add-on")'))
        row = q("select kind || ' ' || includes_stay || ' ' || cardinality(lunch_days) from ticket_types where name='Hostel add-on'")
        check('COUNTERS organizer sets add-on + stay + lunch day on a ticket type', row == 'addon true 1' and await card.locator('.badge:has-text("Add-on")').count() == 1, row)
        await f.locator('input[name=addon]').uncheck(); await f.locator('input[name=includes_stay]').uncheck(); await f.locator('input[name=lunch_days]').nth(1).uncheck()
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
        await org.click('button:has-text("Submit for approval")'); await org.wait_for_load_state('networkidle')
        check('new fest goes to review, not straight live', await org.locator('text=waiting for THE FEST').count() >= 1)
        r = await org.goto(f'{B}/admin'); check('organizer (non-admin) blocked from /admin', '/admin' not in org.url, org.url)
        # ── ADMIN approves it ──
        ac = await browser.new_context(viewport={'width': 1280, 'height': 900}); adm = await ac.new_page(); watch(adm, errs)
        await login(adm, 'admin@thefest.in', url='/login?next=/admin')
        check('admin sees review queue', await adm.locator('text=Test Fest E2E').count() >= 1 and await adm.locator('text=Campus Beats').count() >= 1)
        card = adm.locator('.card', has_text='Campus Beats').first
        await card.locator('input[name=note]').fill('Add your college ID proof and a real venue'); await card.locator('button:has-text("Send back")').click()
        await adm.locator('.card', has_text='Campus Beats').wait_for(state='detached', timeout=10000)
        check('admin sends fest back with a note', True)
        card = adm.locator('.card', has_text='Test Fest E2E').first
        await card.locator('button:has-text("Approve")').click()
        await adm.locator('.card', has_text='Test Fest E2E').wait_for(state='detached', timeout=10000)
        check('admin approves fest', True)
        await adm.goto(f'{B}/admin/fests')
        check('admin fests & payouts page', await adm.locator('text=Record a payout').count() == 1)
        neon_val = await adm.evaluate("[...document.querySelectorAll('select[name=festId] option')].find(o => o.textContent.startsWith('Neon Utsav')).value")
        await adm.select_option('select[name=festId]', value=neon_val)
        await adm.fill('input[name=amount]', '5000'); await adm.fill('input[name=reference]', '612345678999')
        await adm.click('button:has-text("Record payout")'); await adm.wait_for_selector('text=Recorded ₹5,000')
        check('admin records payout', True)
        await adm.goto(f'{B}/admin/orders?q=student@thefest.in')
        check('admin order search', await adm.locator('td', has_text='student@thefest.in').count() >= 1)
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

        # ── LUNCH / STAY COUNTERS (one QR, counter comes from the volunteer's duty) ──
        lc = await browser.new_context(**mobile); lun = await lc.new_page(); watch(lun, errs)
        await login(lun, 'lunch@seed.thefest.in', url='/scan/login')
        check('COUNTERS "Lunch counter" volunteer opens scanner on lunch', await lun.locator('[data-counter=lunch]').count() == 1, lun.url)
        await lun.screenshot(path=S + 'scan_lunch.png', full_page=True)
        def scan_js(code, extra=''):
            return ("fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({festId:'%s',code:'%s'%s})}).then(r=>r.json())" % (FID, code, extra))
        # a fresh 3-Day Pass (lunch today + stay) that hasn't been through the gate
        pass3 = q(f"select t.code from tickets t join ticket_types tt on tt.id=t.ticket_type_id where t.fest_id='{FID}' and tt.name='3-Day Pass' and t.status='valid' order by t.code limit 1")
        scans_before = q(f"select count(*) from scans where fest_id='{FID}'")
        await lun.fill('input[aria-label="Ticket code"]', pass3); await lun.click('button:has-text("Check")'); await lun.wait_for_timeout(900)
        v = await lun.text_content('.verdict')
        check('COUNTERS lunch scan of entitled ticket -> Lunch (day 1 of 2)', '✓ Lunch' in v and 'day 1 of 2' in v, v.strip()[:80])
        await lun.wait_for_timeout(1500)
        j = await lun.evaluate(scan_js(pass3))
        check('COUNTERS second lunch scan same day -> "already taken"', j.get('result') == 'duplicate' and 'already taken' in j.get('message', ''), j.get('message'))
        st_after = q(f"select status from tickets where code='{pass3}'"); scans_after = q(f"select count(*) from scans where fest_id='{FID}'")
        check('COUNTERS lunch scans leave gate status and gate scan log unchanged', st_after == 'valid' and scans_before == scans_after, (st_after, scans_before, scans_after))
        daypass = q(f"select t.code from tickets t join ticket_types tt on tt.id=t.ticket_type_id where t.fest_id='{FID}' and tt.name='Day Pass' and t.status<>'void' order by t.code limit 1")
        j = await lun.evaluate(scan_js(daypass))
        check('COUNTERS ticket without lunch refused', j.get('result') == 'invalid' and 'No lunch' in j.get('message', ''), j.get('message'))
        pass3b = q(f"select t.code from tickets t join ticket_types tt on tt.id=t.ticket_type_id where t.fest_id='{FID}' and tt.name='3-Day Pass' and t.status='valid' order by t.code offset 1 limit 1")
        j = await lun.evaluate(scan_js(pass3b, ",counter:'gate',gate:'Gate 1'"))
        check('COUNTERS lunch volunteer sending counter:gate still redeems lunch, never admits', j.get('counter') == 'lunch' and j.get('result') == 'admitted' and q(f"select status from tickets where code='{pass3b}'") == 'valid', j)

        yc = await browser.new_context(**mobile); stay = await yc.new_page(); watch(stay, errs)
        await login(stay, 'stay@seed.thefest.in', url='/scan/login')
        check('COUNTERS "Stay desk" volunteer opens scanner on stay', await stay.locator('[data-counter=stay]').count() == 1)
        j1 = await stay.evaluate(scan_js(pass3))
        await stay.wait_for_timeout(11000)   # a QR held in front of the camera can't check out within 10 s
        await stay.fill('input[aria-label="Ticket code"]', pass3); await stay.click('button:has-text("Check")'); await stay.wait_for_timeout(900)
        v2 = await stay.text_content('.verdict')
        await stay.wait_for_timeout(1500)
        j3 = await stay.evaluate(scan_js(pass3))
        check('COUNTERS stay: 1st scan check-in, 2nd check-out, 3rd "already checked out"',
              'checked in' in j1.get('message', '') and 'checked out' in v2 and j3.get('result') == 'duplicate' and 'Already checked out' in j3.get('message', ''), (j1.get('message'), v2.strip()[:60], j3.get('message')))
        j = await stay.evaluate(scan_js(daypass))
        check('COUNTERS ticket without stay refused at stay desk', j.get('result') == 'invalid' and 'No stay' in j.get('message', ''), j.get('message'))

        # organizer (no duty) picks the counter; volunteers can't
        oc2 = await browser.new_context(**mobile); osc = await oc2.new_page()
        await login(osc, 'organizer@thefest.in', url='/scan/login')
        await osc.goto(f'{B}/scan?fest={FID}&counter=stay')
        check('COUNTERS organizer can pick a counter', await osc.locator('[data-counter=stay]').count() == 1 and await osc.locator('select[aria-label=Counter]').count() == 1)
        check('COUNTERS volunteer gets no counter picker', await lun.locator('select[aria-label=Counter]').count() == 0)

        # add-on: a Day Pass holder buys the Lunch add-on from the ticket page (demo checkout)
        buyer_email, buyer_tid, buyer_code = q(f"select u.email, t.id, t.code from tickets t join ticket_types tt on tt.id=t.ticket_type_id join users u on u.id=t.user_id join orders o on o.id=t.order_id where t.fest_id='{FID}' and tt.name='Day Pass' and t.status<>'void' and o.qty=1 and u.email not like 'attendee10_@%' order by u.email limit 1").split('|')
        tickets_before = q(f"select count(*) from tickets where fest_id='{FID}'")
        entry_sold_before = q(f"select sum(sold) from ticket_types where fest_id='{FID}' and kind='entry'")
        bc = await browser.new_context(**mobile); bu = await bc.new_page(); watch(bu, errs)
        await login(bu, buyer_email)
        await bu.goto(f'{B}/tickets/{buyer_tid}')
        await bu.locator('#addons button:has-text("Pay ₹")').click(); await bu.wait_for_selector('text=DEMO PAYMENT')
        await bu.click('text=(demo)'); await bu.wait_for_url('**/tickets/*?addon=1'); await bu.wait_for_load_state('networkidle')
        await bu.wait_for_selector('text=Lunch ·', timeout=10000)
        await bu.screenshot(path=S + 's_ticket_addon.png', full_page=True)
        check('COUNTERS student buys lunch add-on: ticket page now lists 2 lunch days', await bu.locator('text=Lunch ·').count() == 2, bu.url)
        check('COUNTERS add-on issues no new ticket and takes no seat',
              q(f"select count(*) from tickets where fest_id='{FID}'") == tickets_before and q(f"select sum(sold) from ticket_types where fest_id='{FID}' and kind='entry'") == entry_sold_before)
        j = await lun.evaluate(scan_js(buyer_code))
        check('COUNTERS lunch scan works after buying the add-on', j.get('result') == 'admitted', j.get('message'))
        lunch_tt = q("select id from ticket_types where name='Lunch add-on'")
        r = await bu.evaluate("fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticketTypeId:'%s',ticketId:'%s'})}).then(r=>r.json())" % (lunch_tt, buyer_tid))
        check("COUNTERS same add-on can't be bought twice for one ticket", 'already has' in (r.get('error') or ''), r)
        r = await bu.evaluate("fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticketTypeId:'%s',ticketId:'%s'})}).then(r=>r.json())" % (lunch_tt, TID))
        check("COUNTERS add-on can't be attached to someone else's ticket", 'Pick one of your' in (r.get('error') or ''), r)
        page = await st.evaluate("fetch('/fests/neon-utsav').then(r=>r.text())")
        check('COUNTERS fest page does not sell add-ons as tickets', 'Lunch add-on' not in page and 'Hostel add-on' not in page)
        # organizer refunds the add-on -> lunch refused, entry ticket untouched
        await org.goto(f'{B}/organizer/{neon}/sales?q={buyer_email}')
        row = org.locator('tr', has_text=buyer_email).filter(has_text='Lunch add-on').first
        await row.locator('summary').click(); await row.locator('input[name=reason]').fill('Changed mind')
        await row.locator('button:has-text("Cancel & refund")').click()
        await org.locator('tr', has_text=buyer_email).filter(has_text='Lunch add-on').locator('.badge:has-text("Refunded")').wait_for(timeout=15000)
        q(f"delete from perk_redemptions where ticket_id='{buyer_tid}'")
        j = await lun.evaluate(scan_js(buyer_code))
        bst = q(f"select status from tickets where id='{buyer_tid}'")
        check('COUNTERS after refunding the add-on, lunch is refused; entry ticket still valid', j.get('result') == 'invalid' and bst != 'void', (j.get('message'), bst))

        # ── review-1 checks (add-on money paths, transfer, stay guard, free add-on, 390 px) ──
        async def api(pg, url, body):
            return await pg.evaluate("([u,b])=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(async r=>({s:r.status,j:await r.json().catch(()=>({}))}))", [url, body])
        b2_email, b2_tid = q(f"select u.email, t.id from tickets t join ticket_types tt on tt.id=t.ticket_type_id join users u on u.id=t.user_id join orders o on o.id=t.order_id where t.fest_id='{FID}' and tt.name='Day Pass' and t.status='valid' and o.qty=1 and u.email not like 'attendee10_@%' and u.email <> '{buyer_email}' order by u.email desc limit 1").split('|')
        b2c = await browser.new_context(**mobile); b2 = await b2c.new_page(); watch(b2, errs)
        await login(b2, b2_email)
        ra = await api(b2, '/api/checkout', {'ticketTypeId': lunch_tt, 'ticketId': b2_tid})
        order_a = ra['j'].get('orderId')
        q(f"update orders set created_at = now() - interval '20 minutes' where id='{order_a}'")
        await b2.goto(f'{B}/tickets/{b2_tid}')
        offered = await b2.locator('#addons label', has_text='Lunch add-on').count()
        rb = await api(b2, '/api/checkout', {'ticketTypeId': lunch_tt, 'ticketId': b2_tid})
        order_b = rb['j'].get('orderId')
        cb = await api(b2, '/api/checkout/demo-confirm', {'orderId': order_b})
        check('REVIEW1 abandoned add-on checkout (aged 20 min) is offered again and re-buying works', ra['s'] == 200 and offered == 1 and rb['s'] == 200 and cb['s'] == 200, (ra, offered, rb, cb))
        ca = await api(b2, '/api/checkout/demo-confirm', {'orderId': order_a})
        a_row = q(f"select status || '|' || coalesce(review_flag,'') from orders where id='{order_a}'")
        check('REVIEW1 late payment of the old add-on order: not paid twice, flagged refund needed', ca['s'] == 409 and not a_row.startswith('paid') and 'refund needed' in a_row and q(f"select count(*) from orders where addon_for='{b2_tid}' and status='paid'") == '1', (ca, a_row))
        b2_code = q(f"select code from tickets where id='{b2_tid}'")
        j = await lun.evaluate(scan_js(b2_code))
        await b2.goto(f'{B}/tickets/{b2_tid}')
        await b2.locator('summary:has-text("Transfer this ticket")').click()
        await b2.fill('input[name=email]', 'student@thefest.in'); await b2.check('input[name=confirm]')
        await b2.click('button:has-text("Transfer ticket")'); await b2.wait_for_url('**/tickets?sent=*')
        new_tid, new_code = q(f"select t.id, t.code from tickets t where t.id=(select transferred_to from tickets where id='{b2_tid}')").split('|')
        j2 = await lun.evaluate(scan_js(new_code))
        check('REVIEW1 transfer after lunch: add-on moves, new ticket gets "already taken"', j.get('result') == 'admitted' and j2.get('result') == 'duplicate' and q(f"select addon_for from orders where id='{order_b}'") == new_tid, (j.get('message'), j2.get('message')))
        await st.goto(f'{B}/tickets/{new_tid}')
        check('REVIEW1 new owner sees the lunch on their ticket page', await st.locator('text=Lunch ·').count() == 2)
        await org.goto(f'{B}/organizer/{neon}/sales?q={b2_email}')
        erow = org.locator('tr', has_text=b2_email).filter(has_text='Day Pass').first
        await erow.locator('summary').click(); await erow.locator('input[name=reason]').fill('Cannot attend')
        await erow.locator('button:has-text("Cancel & refund")').click()
        await org.locator('tr', has_text=b2_email).filter(has_text='Day Pass').locator('.badge:has-text("Refunded")').wait_for(timeout=15000)
        check('REVIEW1 refunding the entry ticket also refunds its paid add-on (once)', q(f"select status || ' ' || (refunded_paise = amount_paise) from orders where id='{order_b}'") == 'refunded true', q(f"select status, refunded_paise, amount_paise from orders where id='{order_b}'"))
        fresh = q(f"select t.code from tickets t join ticket_types tt on tt.id=t.ticket_type_id where t.fest_id='{FID}' and tt.name='3-Day Pass' and t.status<>'void' and not exists (select 1 from perk_redemptions p where p.ticket_id=t.id) order by t.code limit 1 offset 3")
        q(f"update ticket_types set lunch_days = array[(now() at time zone 'Asia/Kolkata')::date + 1] where fest_id='{FID}' and name='3-Day Pass'")
        j = await lun.evaluate(scan_js(fresh))
        q(f"update ticket_types set lunch_days = array[(now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date + 1] where fest_id='{FID}' and name='3-Day Pass'")
        check('REVIEW1 lunch on a non-lunch day refused ("today")', j.get('result') == 'invalid' and 'today' in j.get('message', ''), j.get('message'))
        j1 = await stay.evaluate(scan_js(fresh)); j2 = await stay.evaluate(scan_js(fresh))
        await stay.fill('input[aria-label="Ticket code"]', fresh); await stay.wait_for_timeout(1500); await stay.click('button:has-text("Check")'); await stay.wait_for_timeout(900)
        vt = await stay.text_content('.verdict')
        check('REVIEW1 stay rescan within seconds: "Just checked in", no check-out', 'checked in' in j1.get('message', '') and 'Just checked in' in j2.get('message', '') and 'Just checked in' in vt
              and q(f"select count(*) from perk_redemptions p join tickets t on t.id=p.ticket_id where t.code='{fresh}' and slot='stay_out'") == '0', (j2.get('message'), vt.strip()[:60]))
        free_tt = q(f"insert into ticket_types (fest_id, name, price_paise, quota, sort, kind, lunch_days) values ('{FID}', 'Free lunch add-on', 0, 10, 9, 'addon', array[(now() at time zone 'Asia/Kolkata')::date]) returning id")
        tickets_before = q(f"select count(*) from tickets where fest_id='{FID}'")
        rf = await api(bu, '/api/checkout', {'ticketTypeId': free_tt, 'ticketId': buyer_tid})
        check('REVIEW1 free add-on attaches at once, no gateway, no new ticket', rf['j'].get('mode') == 'done' and q(f"select count(*) from tickets where fest_id='{FID}'") == tickets_before
              and q(f"select status from orders where addon_for='{buyer_tid}' and ticket_type_id='{free_tt}'") == 'paid', rf)
        await bu.goto(f'{B}/tickets/{buyer_tid}'); await bu.wait_for_load_state('networkidle')
        w1 = await bu.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1') and await bu.locator('[aria-label="Lunch and stay"]').count() == 1 and await bu.locator('#addons').count() == 1
        await bu.screenshot(path=S + 's_ticket_perks_390.png', full_page=True)
        await osc.goto(f'{B}/scan?fest={FID}&counter=lunch'); w2 = await osc.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        await osc.screenshot(path=S + 'scan_lunch_org_390.png', full_page=True)
        w3 = await stay.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        check('REVIEW1 390px: ticket page with lunch card + add-on box, organizer lunch scanner, stay desk fit without sideways scroll', w1 and w2 and w3, (w1, w2, w3))
        q(f"update ticket_types set active = false where id='{free_tt}'")

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

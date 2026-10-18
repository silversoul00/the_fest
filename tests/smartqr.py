# Smart QR (TF2): public page, sealed sections per scanner role (offline), live code, key epochs, offline sync.
# First aid was dropped (Harshith, Oct 18 2026): no first-aid card, table or scanner role.
# Run via tests/run-e2e.sh (server on :3000, seeded local database). Acceptance criteria numbers refer to
# the Smart QR research brief (Oct 18, 2026).
import asyncio, base64, os, re, subprocess, sys, uuid
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
S = os.environ.get('E2E_DIR', '/tmp/thefest-e2e') + '/'
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + 'smartqr: ' + name + (f'  [{extra}]' if extra else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def node(*args): return subprocess.run(['node', *args], capture_output=True, text=True, cwd=ROOT).stdout.strip()
def tf2(tid, *flags): return node('--conditions=react-server', 'scripts/sign-ticket.mjs', '--tf2', tid, *flags)
def b64u(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')
def flip(s, i): return s[:i] + ('B' if s[i] != 'B' else 'C') + s[i + 1:]
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
SECRET_BITS = ['9845012345']  # holder phone (organizer section only)

FID = q("select id from fests where slug='neon-utsav'")
def pick(type_name, n, extra=''):
    return q(f"select t.id from tickets t join ticket_types tt on tt.id=t.ticket_type_id where t.fest_id='{FID}' and tt.name='{type_name}' "
             f"and t.status='valid' and t.holder_name not like '% (%/%)' and not exists (select 1 from perk_redemptions p where p.ticket_id=t.id) {extra} "
             f"order by t.issued_at limit {n}").split('\n')
MAIN = pick('3-Day Pass', 1)[0]
MAIN_EMAIL = q(f"select u.email from tickets t join users u on u.id=t.user_id where t.id='{MAIN}'")
DAY = pick('Day Pass', 12, f"and t.user_id <> (select user_id from tickets where id='{MAIN}')")
T2, T3, T4, T5, T6, T7, T8, T9, TDAY, T10, T11, T12 = DAY
LT = pick('3-Day Pass', 1, f"and t.id <> '{MAIN}'")[0]  # lunch synced on a later day
B_EMAIL = q(f"select email from users where email like 'attendee%' and email <> '{MAIN_EMAIL}' order by email desc limit 1")
q(f"update users set phone='9845012345' where email='{MAIN_EMAIL}'")
q(f"update tickets set holder_name='Abhishek Venkataraman Iyer' where id='{MAIN}'")
# Duty "First aid" is no longer special: like any other duty name it scans at the gate.
q(f"insert into fest_staff (fest_id, email, name, duty, can_scan) values ('{FID}', '{B_EMAIL}', 'Bharath B', 'First aid', true) on conflict do nothing")
IDB_SHIFT_DAY = """new Promise((res, rej) => { const r = indexedDB.open('thefest-scan', 1); r.onerror = () => rej(r.error);
  r.onsuccess = () => { const db = r.result, tx = db.transaction('queue', 'readwrite'), c = tx.objectStore('queue').openCursor(); let n = 0;
    c.onsuccess = () => { const cur = c.result; if (cur) { const v = cur.value; v.at -= 86400000; cur.update(v); n++; cur.continue(); } };
    tx.oncomplete = () => { db.close(); res(n); }; }; })"""
async def waiting(pg): return await pg.inner_text('[data-offline-ready]')

async def login(b, email, url='/login', ctx_opts=MOBILE):
    c = await b.new_context(**ctx_opts); pg = await c.new_page()
    await pg.goto(B + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return c, pg

async def scanner(b, email, extra=''):
    c, pg = await login(b, email, '/scan/login')
    await pg.goto(f'{B}/scan?fest={FID}{extra}'); await pg.wait_for_selector('[data-offline-ready]', timeout=15000)
    return c, pg

async def scan(pg, text):
    await asyncio.sleep(1.6)  # the scanner holds each verdict for 1.4 s
    if await pg.locator('.verdict').count(): await pg.click('.verdict .big')
    await pg.fill('input[aria-label="Ticket code"]', text); await pg.click('button:has-text("Check")')
    await pg.wait_for_selector('.verdict', timeout=10000); await asyncio.sleep(0.2)
    return await pg.inner_text('.verdict')

async def no_hscroll(pg): return await pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
async def body(pg): return await pg.inner_text('body')
def keys_js(fid): return f"fetch('/api/scan/keys?festId={fid}').then(async r => ({{s: r.status, cc: r.headers.get('cache-control'), j: await r.json()}}))"
def scan_js(payload, gate='Gate 2', counter='gate'):
    return ("fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({festId:'%s',gate:'%s',counter:'%s',payload:%r})}).then(r=>r.text())" % (FID, gate, counter, payload))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── First aid is gone (Harshith, Oct 18) ──
        q("drop table if exists medical_profiles")
        hc = await b.new_context(); hr = await hc.request.get(B + '/api/health')
        check('FA schema check passes on a database without medical_profiles', hr.status == 200, hr.status)
        mc, me = await login(b, MAIN_EMAIL)
        await me.goto(B + '/me')
        check('FA /me has no first-aid card', await me.locator('#first-aid').count() == 0 and 'first-aid' not in (await body(me)).lower())

        # ── Ticket screen: live QR (AC1, AC13, AC17) ──
        await me.goto(f'{B}/tickets/{MAIN}'); await me.wait_for_selector('[data-countdown]')
        box = await me.locator('[aria-label="Ticket QR code"] svg').bounding_box()
        check('AC17 ticket QR ≥ 260px wide at 390px, countdown visible', box and box['width'] >= 259 and await me.locator('[data-countdown]').is_visible(), box)
        check('AC17 ticket screen fits 390px', await no_hscroll(me))
        saved = await me.evaluate(f"JSON.parse(localStorage.getItem('tf_tickets'))['{MAIN}']")
        url = saved['url']
        check('AC1 ticket QR is a TF2 link to /t/…#…', re.match(r'^http://localhost:3000/t/[A-Za-z0-9_-]{32}#[A-Za-z0-9_-]+$', url) is not None, url[:60])
        left = int(re.search(r'(\d+)s', await me.inner_text('[data-countdown]')).group(1))
        before = await me.inner_html('[aria-label="Ticket QR code"]')
        await asyncio.sleep(left + 1.5)
        after_left = int(re.search(r'(\d+)s', await me.inner_text('[data-countdown]')).group(1))
        check('AC13 live QR redraws when the 30 s countdown restarts', after_left > 20 and before != await me.inner_html('[aria-label="Ticket QR code"]'), (left, after_left))
        await me.click('button:has-text("Static QR (for print)")')
        check('AC13 static QR toggle', await me.locator('[data-mode=static]').count() == 1)

        # ── Public page (AC1, AC2, AC3, AC17) ──
        pc = await b.new_context(**MOBILE); pub = await pc.new_page()
        r = await pub.goto(url)
        txt = await body(pub)
        check('AC1 public page: fest, dates, type, first name, status', all(s.lower() in txt.lower() for s in ['Neon Utsav', '3-Day Pass', 'Abhishek', 'Valid', 'Verified by THE FEST']), txt[:200])
        raw = await pc.request.get(url.split('#')[0])
        html = await raw.text()
        code = q(f"select code from tickets where id='{MAIN}'")
        leaks = [s for s in ['Venkataraman', MAIN_EMAIL, code, 'Lunch', 'Stay', '9845012345'] if s in html]
        check('AC2 public page has no full name, email, phone, code or perks', not leaks, leaks)
        h = raw.headers
        check('AC2 public page: noindex, no-store, no-referrer', 'noindex' in h.get('x-robots-tag', '') and 'noindex' in html and 'no-store' in h.get('cache-control', '') and h.get('referrer-policy') == 'no-referrer', h)
        check('AC17 public page fits 390px', await no_hscroll(pub))
        robots = await (await pc.request.get(B + '/robots.txt')).text()
        check('AC2 robots.txt disallows /t/', 'Disallow: /t/' in robots)
        P = url.split('/t/')[1].split('#')[0]
        pbytes = base64.urlsafe_b64decode(P + '==')
        void_id = q("select id from tickets where status='void' limit 1") or MAIN
        bad = [
            'x' * 32, 'hello', b64u(pbytes[:-1] + bytes([pbytes[-1] ^ 1])), b64u(pbytes[:18]),
            b64u(bytes([2]) + uuid.UUID(void_id).bytes + bytes([1]) + os.urandom(6)),
        ]
        rs = [await pc.request.get(f'{B}/t/{x}') for x in bad]
        bodies = [(await x.text()).replace(bad[i], '') for i, x in enumerate(rs)]  # the page echoes its own path, nothing else differs
        check('AC3 random / wrong tag / missing tag / void-with-bad-tag → same 404', all(x.status == 404 for x in rs) and len(set(bodies)) == 1, [x.status for x in rs])

        # ── Keys API (AC9) ──
        anon = await pc.new_page(); await anon.goto(B + '/offline')
        k = await anon.evaluate(keys_js(FID))
        check('AC9 keys: 401 without scanner session', k['s'] == 401, k['s'])
        gc, gate = await scanner(b, 'volunteer@thefest.in')
        k = await gate.evaluate(keys_js(FID))
        roles = sorted({x['role'] for x in k['j'].get('keys', [])})
        check('AC9 keys: gate volunteer gets only gate keys, no-store', k['s'] == 200 and roles == ['gate'] and k['j']['roles'] == ['gate'] and 'no-store' in (k['cc'] or ''), (roles, k['cc']))
        fac, fa = await scanner(b, B_EMAIL)
        k = await fa.evaluate(keys_js(FID))
        check('FA duty "First aid" now scans at the gate (gate keys only)', k['s'] == 200 and k['j']['roles'] == ['gate'] and await fa.locator('[data-counter=gate]').count() == 1, k['j'].get('roles'))
        await fac.close()
        lc, lunch = await scanner(b, 'lunch@seed.thefest.in')
        hv = q("select id from fests where slug='hackverse'")
        k = await lunch.evaluate(keys_js(hv))
        check('AC9 keys: 403 for a fest you are not on', k['s'] == 403, k['s'])
        dates = q(f"select starts_on || ' ' || ends_on from fests where id='{FID}'").split()
        q(f"update fests set starts_on = current_date - 4, ends_on = current_date - 2 where id='{FID}'")
        k = await gate.evaluate(keys_js(FID))
        q(f"update fests set starts_on = '{dates[0]}', ends_on = '{dates[1]}' where id='{FID}'")
        check('AC9 keys: not served after fest end + 1 day', k['s'] == 403, k['s'])

        U_MAIN, U_DAY = tf2(MAIN), tf2(TDAY)
        U_E1 = tf2(T6)  # sealed under key epoch 1, for the reset test

        # ── Lunch volunteer offline (AC6, AC12) ──
        await lc.set_offline(True)
        v = await scan(lunch, U_MAIN)
        t = await body(lunch)
        check('AC6 lunch offline: lunch today ✓, saved', 'Lunch' in v and 'saved' in v and 'Lunch today ✓' in await lunch.inner_text('[data-role=lunch]'), v)
        check('AC6 lunch page shows no name/phone', not [s for s in SECRET_BITS + ['Abhishek'] if s in t] and await lunch.locator('[data-role=gate],[data-role=org]').count() == 0)
        v = await scan(lunch, U_MAIN)
        check('AC12 lunch offline twice → already taken (this phone)', 'this phone' in v, v)
        v = await scan(lunch, U_DAY)
        check('AC12 lunch offline on a no-lunch ticket → No lunch today', 'No lunch today' in v, v)
        await lc.set_offline(False)
        await lunch.wait_for_selector('.list :text("Synced")', timeout=10000)
        v = await scan(lunch, U_MAIN)
        n = q(f"select count(*) from perk_redemptions where ticket_id='{MAIN}' and slot like 'lunch:%'")
        check('AC12 synced: one lunch row, online re-scan says already taken', n == '1' and 'already' in v.lower(), (n, v))

        # ── Lunch saved offline on an earlier day is not recorded today (should-fix 4) ──
        await lc.set_offline(True)
        v = await scan(lunch, tf2(LT))
        shifted = await lunch.evaluate(IDB_SHIFT_DAY)   # pretend the scan happened yesterday
        await lc.set_offline(False)
        await lunch.wait_for_selector('.list :text("Not recorded: lunch from")', timeout=10000)
        n = q(f"select count(*) from perk_redemptions where ticket_id='{LT}'")
        v2 = await scan(lunch, tf2(LT))
        check('SYNC yesterday\'s offline lunch is not recorded; today\'s lunch still works', 'saved' in v and shifted == 1 and n == '0' and v2.startswith('✓ Lunch'), (v, shifted, n, v2))

        # ── Stay volunteer offline (AC6) ──
        sc, stay = await scanner(b, 'stay@seed.thefest.in')
        await sc.set_offline(True)
        v = await scan(stay, U_MAIN); t = await body(stay)
        check('AC6 stay offline: stay yes, checked in, saved', 'checked in' in v and 'Stay: yes' in await stay.inner_text('[data-role=stay]'), v)
        check('AC6 stay page shows no name/phone', not [s for s in SECRET_BITS + ['Abhishek'] if s in t] and await stay.locator('[data-role=gate],[data-role=org],[data-role=lunch]').count() == 0)
        await sc.set_offline(False); await stay.wait_for_selector('.list :text("Synced")', timeout=10000)
        check('AC6 stay synced once', q(f"select count(*) from perk_redemptions where ticket_id='{MAIN}' and slot='stay_in'") == '1')

        # ── Organizer + co-organizer see everything (AC8, AC17) ──
        oc, org = await scanner(b, 'organizer@thefest.in', '&counter=lunch')
        await oc.set_offline(True)
        await scan(org, U_MAIN)
        roles_seen = [r for r in ['gate', 'lunch', 'stay', 'aid', 'org'] if await org.locator(f'[data-role={r}]').count()]
        check('AC8 organizer sees all sections incl. holder phone (no aid)', roles_seen == ['gate', 'lunch', 'stay', 'org'] and '9845012345' in await org.inner_text('[data-role=org]'), roles_seen)
        check('AC17 scanner role card fits 390px', await no_hscroll(org))
        await org.screenshot(path=S + 'smartqr_org_card.png', full_page=True)
        await oc.set_offline(False)
        q(f"insert into fest_members (fest_id, email) values ('{FID}', 'organizer2@thefest.in') on conflict do nothing")
        cc, co = await scanner(b, 'organizer2@thefest.in', '&counter=lunch')
        await cc.set_offline(True); await scan(co, U_MAIN)
        check('AC8 co-organizer sees all sections incl. holder phone', await co.locator('[data-role=org]').count() == 1 and await co.locator('[data-role=gate]').count() == 1)
        check('FA counter picker has no first aid', 'first aid' not in (await co.inner_text('select[aria-label=Counter]')).lower())
        await cc.set_offline(False); await cc.close()
        q(f"delete from fest_members where fest_id='{FID}' and email='organizer2@thefest.in'")

        # ── Gate volunteer offline (AC4, AC6, AC10, AC11) ──
        U_T2 = tf2(T2)
        await gc.set_offline(True)
        v = await scan(gate, U_MAIN); t = await body(gate)
        g = await gate.inner_text('[data-role=gate]')
        check('AC11 gate offline → amber "saved"', 'saved' in v and await gate.locator('.verdict.offline').count() == 1, v)
        check('AC6 gate offline sees full name (20 chars) + type', 'Abhishek Venkatarama' in g and '3-Day Pass' in g, g)
        check('AC6 gate page shows no phone', not [s for s in SECRET_BITS if s in t] and await gate.locator('[data-role=org],[data-role=lunch]').count() == 0)
        v = await scan(gate, U_MAIN)
        check('AC11 same ticket again on this phone → Already in (this phone)', 'Already in (this phone)' in v, v)
        parts = U_MAIN.split('/t/')[1]; pp, ff = parts.split('#')
        v1 = await scan(gate, U_MAIN.replace(pp, flip(pp, 5)))
        v2 = await scan(gate, U_MAIN.replace(ff, flip(ff, 40)))
        check('AC4 tampered P / F offline → Fake or tampered', 'Fake or tampered' in v1 and 'Fake or tampered' in v2, (v1, v2))
        await scan(gate, U_T2)
        tf1 = node('scripts/sign-ticket.mjs', T7, FID)
        v = await scan(gate, tf1)
        check('AC10 old TF1 ticket offline → saved, "Old-style ticket"', 'saved' in v and 'Old-style ticket' in v, v)
        j = await org.evaluate(scan_js(U_T2, gate='Gate 2'))
        check('another gate admits T2 online meanwhile', '"admitted"' in j, j[:80])
        await gc.set_offline(False)
        await gate.wait_for_function("document.querySelectorAll('.list .li').length && ![...document.querySelectorAll('[data-offline-ready]')].some(e => e.textContent.includes('waiting'))", timeout=15000)
        feed = await gate.inner_text('.list')
        check('AC11 back online: queue syncs, "Synced: was already used" for T2', 'Synced: was already used' in feed and 'Synced ✓' in feed, feed[:300])
        adm = q(f"select (select count(*) from scans where ticket_id='{MAIN}' and result='admitted') || ',' || (select count(*) from scans where ticket_id='{T2}' and result='admitted') || ',' || (select status from tickets where id='{MAIN}') || ',' || (select status from tickets where id='{T7}')")
        check('AC11 never admitted twice in the database', adm == '1,1,used,used', adm)
        v1 = await scan(gate, U_MAIN.replace(pp, flip(pp, 5)))
        check('AC4 tampered online → Fake or tampered', 'Fake or tampered' in v1, v1)

        # ── Sync keeps the queue unless our server clearly answers (must-fix 2) ──
        await gc.set_offline(True)
        v1 = await scan(gate, tf2(T10)); v2 = await scan(gate, tf2(T11))
        check('SYNC two offline gate scans queued', 'saved' in v1 and 'saved' in v2 and '2 scans waiting' in await waiting(gate), (v1, v2))
        portal = lambda route: route.fulfill(status=200, content_type='text/html', body='<html>Log in to campus Wi-Fi</html>')
        await gate.route('**/api/scan', portal)
        await gc.set_offline(False); await asyncio.sleep(3)
        st = q(f"select string_agg(status::text, ',') from tickets where id in ('{T10}', '{T11}')")
        check('SYNC Wi-Fi login page (HTML 200) keeps both queued', '2 scans waiting' in await waiting(gate) and st == 'valid,valid', (await waiting(gate), st))
        await gate.unroute('**/api/scan', portal)
        down = lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"Service unavailable"}')
        await gate.route('**/api/scan', down)
        await gate.click('[data-sync-now]'); await asyncio.sleep(2)
        check('SYNC server 503 keeps both queued', '2 scans waiting' in await waiting(gate) and q(f"select count(*) from scans where ticket_id in ('{T10}', '{T11}')") == '0', await waiting(gate))
        await gate.unroute('**/api/scan', down)
        # no "online" event now — only the retry timer (every 30 s) can send them
        try:
            await gate.wait_for_function("!document.querySelector('[data-offline-ready]').textContent.includes('waiting')", timeout=45000)
        except Exception: pass
        st = q(f"select string_agg(status::text, ',' order by status) from tickets where id in ('{T10}', '{T11}')")
        adm = q(f"select count(*) from scans where ticket_id in ('{T10}', '{T11}') and result='admitted'")
        check('SYNC retry timer sends both once the server is back; both used, admitted once each', st == 'used,used' and adm == '2', (st, adm))

        # ── Lock with a queue: scans stay with the volunteer who made them (should-fix 5) ──
        A_ID = q("select id from users where email='volunteer@thefest.in'")
        await gc.set_offline(True)
        v = await scan(gate, tf2(T12))
        await gate.route('**/api/scan', down); await gc.set_offline(False)
        msgs = []
        async def on_dialog(d):
            msgs.append(d.message); await d.accept()
        gate.on('dialog', on_dialog)
        await gate.click('button:has-text("Lock")'); await gate.wait_for_url('**/scan/login', timeout=10000)
        check('SYNC Lock with an unsynced scan warns first', 'saved' in v and msgs and '1 scan not synced' in msgs[0], msgs)
        await gate.unroute('**/api/scan', down)
        await gate.fill('input[name=email]', B_EMAIL); await gate.fill('input[name=password]', 'password123')
        await gate.click('button[type=submit]'); await gate.wait_for_url(lambda u: '/scan/login' not in u, timeout=15000)
        await gate.goto(f'{B}/scan?fest={FID}'); await gate.wait_for_selector('[data-offline-ready]', timeout=15000)
        await asyncio.sleep(3)
        oth = await gate.locator('[data-others-queued]').count()
        n = q(f"select count(*) from scans where ticket_id='{T12}'")
        check('SYNC next volunteer on the phone does not send it (shown as another volunteer\'s)', oth == 1 and n == '0' and q(f"select status from tickets where id='{T12}'") == 'valid', (oth, n))
        await gate.goto(B + '/scan/login')
        await gate.fill('input[name=email]', 'volunteer@thefest.in'); await gate.fill('input[name=password]', 'password123')
        await gate.click('button[type=submit]'); await gate.wait_for_url(lambda u: '/scan/login' not in u, timeout=15000)
        await gate.goto(f'{B}/scan?fest={FID}'); await gate.wait_for_selector('[data-offline-ready]', timeout=15000)
        by = ''
        for _ in range(30):  # it may already have synced on the page the login redirected to
            by = q(f"select scanned_by from scans where ticket_id='{T12}' and result='admitted'")
            if by: break
            await asyncio.sleep(1)
        check('SYNC same volunteer logs in again → it syncs under their name', by == A_ID, by)

        # ── TF1 + backup codes online (AC10), live chips online (AC13) ──
        tf1b = node('scripts/sign-ticket.mjs', T8, FID)
        j1 = await gate.evaluate(scan_js(tf1b, 'Gate 1')); j2 = await gate.evaluate(scan_js(tf1b, 'Gate 1'))
        check('AC10 TF1 online admits exactly once', '"admitted"' in j1 and '"duplicate"' in j2)
        c9 = q(f"select code from tickets where id='{T9}'")
        j = await gate.evaluate("fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({festId:'%s',gate:'Gate 1',code:'%s'})}).then(r=>r.text())" % (FID, c9))
        check('AC10 backup code still admits', '"admitted"' in j, j[:80])
        for tid, flag, want in [(T3, '--live', 'Live ✓'), (T4, None, 'Static'), (T5, '--old', 'Old screenshot')]:
            u = tf2(tid, flag) if flag else tf2(tid)
            v = await scan(gate, u)
            check(f'AC13 {want} chip and admitted once online', 'Admit' in v and want.lower() in v.lower(), v)
        v = await scan(gate, tf2(T3, '--live'))
        check('AC13 live QR re-scan → Already in', 'Already in' in v, v)

        # ── Worst-case QR through the fake camera (AC5) ──
        worst = tf2(MAIN, '--live')
        ver = node('-e', "console.log(require('qrcode').create(process.argv[1], {errorCorrectionLevel:'M'}).version)", worst)
        check('AC5 worst case (all sections + live, 20-char name) ≤ 290 chars, ≤ v13', len(worst) <= 290 and int(ver) <= 13, (len(worst), ver))
        node('-e', "require('qrcode').toFile(process.argv[1], process.argv[2], {width:600, margin:4}, e => process.exit(e ? 1 : 0))", S + 'qr2.png', worst)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-i', S + 'qr2.png', '-vf', 'scale=640:640,format=yuv420p', '-t', '6', '-r', '15', S + 'qr2.y4m'], check=True)
        cam = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={S}qr2.y4m'])
        camc, camp = await scanner(cam, 'organizer@thefest.in', '&counter=lunch')
        await camp.click('button:has-text("Start camera")')
        await camp.wait_for_selector('.verdict [data-role=org]', timeout=20000)
        check('AC5 worst-case QR scans in the fake camera', '9845012345' in await camp.inner_text('[data-role=org]'))
        await cam.close()

        ec, eo = await login(b, 'organizer@thefest.in')

        # ── Saved ticket on /offline (AC16) ──
        await me.goto(f'{B}/tickets/{MAIN}')
        await me.evaluate("navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)")
        await me.reload(); await me.wait_for_load_state('networkidle'); await asyncio.sleep(2)
        cached = await me.evaluate("caches.open('thefest-v3').then(async c => { const r = await c.match('/offline'); if (!r) return 'no page'; const h = await r.text(); const s = [...h.matchAll(/src=\"(\\/_next\\/static\\/[^\"]+)\"/g)].map(m => m[1]); const miss = []; for (const x of s) if (!(await c.match(x))) miss.push(x); return miss.length ? 'missing ' + miss.join(' ') : 'ok ' + s.length; })")
        check('AC16 /offline and its scripts are cached', cached.startswith('ok'), cached)
        await mc.set_offline(True)
        try:
            await me.goto(B + '/offline'); await me.wait_for_selector('[data-saved-tickets] [aria-label="Ticket QR code"] svg', timeout=10000)
            check('AC16 saved ticket shows on /offline with network off', True)
        except Exception as e:
            check('AC16 saved ticket shows on /offline with network off', False, str(e)[:120])
        await mc.set_offline(False)
        await me.goto(B + '/me'); await me.click('button:has-text("Log out")'); await me.wait_for_url('**/login')
        await me.goto(B + '/offline'); await asyncio.sleep(1)
        check('AC16 saved tickets cleared after logout', await me.locator('[data-saved-tickets]').count() == 0)

        # ── Reset scanner keys (AC14) ──
        await eo.goto(f'{B}/organizer/{FID}/volunteers')
        await eo.click('summary:has-text("Reset scanner keys")'); await eo.click('button:has-text("Reset scanner keys")')
        await eo.wait_for_selector('#reset-keys .alert.ok')
        n = q(f"select count(*) from sessions s join users u on u.id=s.user_id where s.kind='scanner' and u.email in ('volunteer@thefest.in', 'organizer@thefest.in')")
        check('AC14 reset bumps epoch and logs out the fest\'s scanners', q(f"select qr_epoch from fests where id='{FID}'") == '2' and n == '0', n)
        k = await gate.evaluate(keys_js(FID))
        check('AC14 old scanner session refused', k['s'] == 401)
        await gc.close()
        gc, gate = await scanner(b, 'volunteer@thefest.in')
        await gc.set_offline(True)
        v = await scan(gate, U_E1)
        check('AC14 previous-epoch QR still opens offline after re-login', 'saved' in v, v)
        await gc.set_offline(False); await asyncio.sleep(2)
        await eo.reload(); await eo.click('summary:has-text("Reset scanner keys")'); await eo.click('button:has-text("Reset scanner keys")')
        await eo.wait_for_selector('#reset-keys .alert.ok')
        await gc.close()
        gc, gate = await scanner(b, 'volunteer@thefest.in')
        await gc.set_offline(True)
        v = await scan(gate, U_E1)
        check('AC14 two epochs old → needs network', 'needs network' in v, v)
        await gc.set_offline(False)
        r2c, r2 = await login(b, 'organizer2@thefest.in')
        r = await r2.goto(f'{B}/organizer/{FID}/volunteers')
        check('AC14 only owner/co-organizers reach the reset button', r.status == 404)

        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\nsmartqr: {len(results) - len(failed)}/{len(results)} passed')
    if failed: sys.exit(1)

asyncio.run(main())

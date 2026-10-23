# Bug-hunt fixes (2026-10-23, docs/team/reviews/2026-10-23-full-bug-hunt.md) + M4 "Allow + email buyers".
# Main server on :3000 with the seeded database. Runs last: it adds its own fests/users/orders.
import asyncio, hashlib, os, subprocess, sys
from playwright.async_api import async_playwright

B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
DESKTOP = dict(viewport={'width': 1280, 'height': 900})
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()

async def login(b, email, ctx_opts=MOBILE):
    ctx = await b.new_context(**ctx_opts); pg = await ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200])); pg.errs = errs
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def alert(pg, want, timeout=8000):
    loc = pg.locator('.alert', has_text=want)
    try: await loc.first.wait_for(timeout=timeout); return True
    except Exception: return False
async def body(pg): return await pg.locator('body').inner_text()
async def no_sideways(pg): return await pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')
async def unlimit(pg): await pg.evaluate("document.querySelectorAll('input').forEach(i => { i.removeAttribute('min'); i.removeAttribute('max'); i.removeAttribute('step'); })")
async def crashed(pg): return 'Something went wrong' in await body(pg)

def wait_outbox(where, n=1, tries=40):
    import time
    for _ in range(tries):
        if int(q(f"select count(*) from email_outbox where {where}") or 0) >= n: return True
        time.sleep(0.25)
    return False

# ─── fixtures ─────────────────────────────────────────────
ORG = q("select id from users where email='organizer@thefest.in'")
STU = q("select id from users where email='student@thefest.in'")
PW = q("select password_hash from users where email='student@thefest.in'")
D = lambda n: q(f"select ((now() at time zone 'Asia/Kolkata')::date + {n})::text")

def mk_fest(slug, name, s, e, venue='Hall A', status='live', upi=False):
    return q(f"""insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, status, approved_at, upi_enabled, upi_vpa)
                 values ('{slug}', '{ORG}', '{name}', 'Bug College', 'Bengaluru', '{venue}', 'cultural', current_date + {s}, current_date + {e}, '{status}',
                         {'now()' if status == 'live' else 'null'}, {str(upi).lower()}, {"'bugfest@icici'" if upi else 'null'}) returning id""").split('\n')[0]
def mk_type(fid, name='Day Pass', lunch=None, sold=0):
    days = f"array[current_date + {lunch}]::date[]" if lunch is not None else "'{}'::date[]"
    return q(f"insert into ticket_types (fest_id, name, price_paise, quota, sold, lunch_days) values ('{fid}', '{name}', 10000, 100, {sold}, {days}) returning id").split('\n')[0]
def mk_ticket(fid, tt, user=None, code='TF-BUG1-0001'):
    user = user or STU
    oid = q(f"insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, status, provider, paid_at) values ('{user}', '{fid}', '{tt}', 1, 10000, 'paid', 'demo', now()) returning id").split('\n')[0]
    return q(f"insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name) select '{code}', '{oid}', '{user}', '{fid}', '{tt}', name from users where id='{user}' returning id").split('\n')[0]
def mk_user(email, name):
    return q(f"insert into users (email, password_hash, name, role, email_verified_at) values ('{email}', '{PW}', '{name}', 'student', now()) returning id").split('\n')[0]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── H1 open redirect ──
        st = await login(b, 'student@thefest.in')
        bad = ['//example.org/phish', '/%5Cexample.org/phish', '/\\example.org', '/%2F%2Fexample.org', 'https://example.org', '/%09/example.org', 'javascript:alert(1)']
        locs = []
        for n in bad:
            r = await st.request.get(B + '/login?next=' + n.replace('\\', '%5C'), max_redirects=0)
            locs.append(r.headers.get('location', ''))
        check('H1 logged in: /login?next=<other site> stays on THE FEST (//, /\\, encoded, scheme, tab)',
              all(l.startswith('/') and not l.startswith('//') and '\\' not in l and 'example' not in l for l in locs), locs)
        r = await st.request.get(B + '/login?next=/me', max_redirects=0)
        check('H1 logged in: a normal next=/me still works', r.headers.get('location', '') == '/me', r.headers.get('location'))
        anon = await (await b.new_context(**MOBILE)).new_page()
        await anon.goto(B + '/login?next=/%5Cexample.org/phish')
        hidden = await anon.locator('input[name=next]').input_value()
        await anon.fill('input[name=email]', 'student@thefest.in'); await anon.fill('input[name=password]', 'password123')
        await anon.click('button[type=submit]'); await anon.wait_for_load_state('networkidle')
        check('H1 login form with next=/\\example.org: next dropped, lands in the portal on THE FEST', hidden == '' and anon.url.startswith(B), (hidden, anon.url))
        anon2 = await (await b.new_context(**MOBILE)).new_page()
        await anon2.goto(B + '/signup?next=//example.org')
        check('H1 signup form drops an off-site next', await anon2.locator('input[name=next]').input_value() == '')

        # ── fixtures for organizer checks ──
        m4 = mk_fest('bug-m4', 'Bug Fest', 20, 21)
        m4tt = mk_type(m4, 'Day Pass + Lunch', lunch=21, sold=1)
        mk_ticket(m4, m4tt)
        empty = mk_fest('bug-m4-empty', 'Empty Bug Fest', 20, 21)
        mk_type(empty)
        org = await login(b, 'organizer@thefest.in')

        # ── M1 numbers ──
        await org.goto(B + '/organizer/new')
        await org.fill('input[name=name]', 'Huge Capacity Fest'); await org.fill('input[name=college]', 'Bug College')
        await org.fill('input[name=starts_on]', D(30)); await org.fill('input[name=ends_on]', D(31))
        await org.fill('input[name=capacity]', '99999999999'); await unlimit(org)
        await org.click('button:has-text("Create fest")')
        ok = await alert(org, 'Capacity can be at most')
        check('M1 new fest capacity 99,999,999,999: friendly limit message, typed name kept, no crash',
              ok and await org.locator('input[name=name]').input_value() == 'Huge Capacity Fest' and not await crashed(org))
        await org.fill('input[name=capacity]', '-3'); await org.click('button:has-text("Create fest")')
        check('M1 new fest negative capacity refused', await alert(org, 'whole number'))
        await org.fill('input[name=capacity]', ''); await org.fill('input[name=ticket_price]', '99999999'); await unlimit(org)
        await org.click('button:has-text("Create fest")')
        check('M1 new fest ticket price over ₹10,000 refused', await alert(org, 'Ticket price must be between'))
        await org.goto(f'{B}/organizer/{m4}/settings')
        await org.fill('input[name=capacity]', '3000000000'); await unlimit(org); await org.click('button:has-text("Save changes")')
        check('M1 settings capacity 3,000,000,000: limit message, no crash', await alert(org, 'Capacity can be at most') and not await crashed(org)
              and q(f"select coalesce(capacity::text,'null') from fests where id='{m4}'") == 'null')
        adm = await login(b, 'admin@thefest.in')
        await adm.goto(B + '/admin/fests')
        await adm.select_option('select[name=festId]', m4)
        await adm.fill('input[name=amount]', '99999999'); await unlimit(adm); await adm.click('button:has-text("Record payout")')
        check('M1 admin payout ₹9,99,99,999: "at most ₹2 crore", nothing recorded, no crash',
              await alert(adm, 'at most ₹2 crore') and q(f"select count(*) from payouts where fest_id='{m4}'") == '0' and not await crashed(adm))

        # ── M2 sponsor amount ──
        await org.goto(f'{B}/organizer/{m4}/sponsors')
        await org.fill('input[name=brand]', 'Crore Brand'); await org.fill('input[name=email]', 'crore@brand.example')
        await org.fill('input[name=amount]', '30000000'); await unlimit(org); await org.click('button:has-text("Add sponsor")')
        t = await body(org)
        check('M2 sponsor deal ₹3 crore: "at most ₹1 crore", not "already added"', await alert(org, 'at most ₹1 crore') and 'already added' not in t)
        await org.fill('input[name=amount]', '-5'); await org.click('button:has-text("Add sponsor")')
        check('M2 negative deal amount: "can’t be negative"', await alert(org, 'can’t be negative'))
        await org.fill('input[name=amount]', '50000'); await org.click('button:has-text("Add sponsor")')
        added = await alert(org, 'Crore Brand added')
        await org.goto(f'{B}/organizer/{m4}/sponsors')
        await org.fill('input[name=brand]', 'Crore Brand'); await org.fill('input[name=email]', 'crore@brand.example'); await org.fill('input[name=amount]', '50000')
        await org.click('button:has-text("Add sponsor")')
        check('M2 the same sponsor twice: "already added" (only for a real duplicate)', added and await alert(org, 'already added')
              and q(f"select count(*) from sponsors where fest_id='{m4}'") == '1')

        # ── M3 confirm in one tab, reject in another ──
        import random
        UTRS = [str(random.randint(6 * 10**11, 7 * 10**11 - 1)) for _ in range(2)]  # unique: other tests used fixed UTRs
        m3 = mk_fest('bug-m3', 'UPI Bug Fest', 20, 21, upi=True)
        m3tt = mk_type(m3, sold=3)
        o1, o2, o3 = [q(f"""insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, status, provider, method, utr, utr_submitted_at)
                            values ('{STU}', '{m3}', '{m3tt}', 1, {10037 + i}, 'pending', 'upi_direct', 'upi_direct', {f"'{UTRS[i]}'" if i < 2 else 'null'}, now()) returning id""").split('\n')[0] for i in range(3)]
        tab1 = await org.context.new_page(); tab2 = await org.context.new_page()
        for tb in (tab1, tab2): await tb.goto(f'{B}/organizer/{m3}/payments')
        row = lambda tb, amt: tb.locator('div', has_text=amt).filter(has=tb.locator('button:has-text("Reject")')).last
        await row(tab1, '₹100.37').locator('button:has-text("Confirm")').click(); await tab1.wait_for_load_state('networkidle')
        for _ in range(40):
            if q(f"select status from orders where id='{o1}'") == 'paid': break
            await tab1.wait_for_timeout(250)
        await row(tab2, '₹100.37').locator('button:has-text("Reject")').click()
        ok = await alert(tab2, 'already confirmed or rejected')
        check('M3 Reject after Confirm (2nd tab): calm "already handled" note, no error page, order stays paid',
              ok and not await crashed(tab2) and q(f"select status from orders where id='{o1}'") == 'paid', tab2.url)
        for tb in (tab1, tab2): await tb.goto(f'{B}/organizer/{m3}/payments')
        await row(tab1, '₹100.38').locator('button:has-text("Reject")').click(); await tab1.wait_for_load_state('networkidle')
        for _ in range(40):
            if q(f"select status from orders where id='{o2}'") == 'failed': break
            await tab1.wait_for_timeout(250)
        await row(tab2, '₹100.38').locator('button:has-text("Confirm")').click(); await tab2.wait_for_load_state('networkidle')
        await tab2.wait_for_timeout(500)
        # Confirming a rejected order is allowed on purpose (the money can turn up later) — it must just work, once
        check('M3 Confirm after Reject (2nd tab): no error page; the order ends paid with exactly one ticket',
              not await crashed(tab2) and q(f"select status from orders where id='{o2}'") == 'paid' and q(f"select count(*) from tickets where order_id='{o2}'") == '1')

        # ── L3 fake UTR ──
        res = []
        for utr in ['000000000000', '111111111111']:
            r = await st.request.post(B + '/api/checkout/upi-utr', data={'orderId': o3, 'utr': utr}, headers={'Origin': B})
            res.append((r.status, (await r.json()).get('error', '')))
        check('L3 UTR 000000000000 / 111111111111 refused with a clear message', all(s == 409 and 'real UTR' in e for s, e in res)
              and q(f"select coalesce(utr,'') from orders where id='{o3}'") == '', res)

        # ── M4 fest changes after tickets are sold ──
        await org.goto(f'{B}/organizer/{m4}/settings')
        await org.fill('textarea[name=description]', 'Only the description changed.')
        notice_desc = await org.locator('[data-testid=change-notice]').count()
        await org.click('button:has-text("Save changes")')
        ok = await alert(org, 'Saved.')
        check('M4 description-only change: saved, no warning, no email', ok and notice_desc == 0
              and q("select count(*) from email_outbox where subject like 'Bug Fest%changed'") == '0')
        await org.goto(f'{B}/organizer/{m4}/settings')
        await org.fill('input[name=venue]', 'Hall B')
        nt = await org.locator('[data-testid=change-notice]').inner_text() if await org.locator('[data-testid=change-notice]').count() else ''
        await org.click('button:has-text("Save changes")')
        blocked = await alert(org, 'Tick “I understand”')
        check('M4 venue change with tickets sold: warns "emails 1 ticket holder" before saving; not saved until ticked',
              'emails 1 ticket holder' in nt and 'admin review' not in nt and blocked and q(f"select venue from fests where id='{m4}'") == 'Hall A', nt)
        await org.check('input[name=confirm_notice]'); await org.click('button:has-text("Save changes")')
        ok = await alert(org, 'ticket holder(s) are being emailed')
        mailed = wait_outbox("to_email='student@thefest.in' and subject like 'Bug Fest%changed' and body_text like '%Venue: Hall A → Hall B%'")
        check('M4 venue saved after "I understand": the ticket holder gets an email "Venue: Hall A → Hall B"; fest stays live',
              ok and mailed and q(f"select venue || '|' || status from fests where id='{m4}'") == 'Hall B|live')
        await org.goto(f'{B}/organizer/{m4}/settings')
        await org.fill('input[name=ends_on]', D(20))
        await org.click('button:has-text("Save changes")')
        ok = await alert(org, 'is already sold')
        check('M4 new dates that drop an already-sold lunch day are blocked with a clear message', ok
              and q(f"select ends_on::text from fests where id='{m4}'") == D(21))
        await org.goto(f'{B}/organizer/{m4}/settings')
        await org.fill('input[name=starts_on]', D(21)); await org.fill('input[name=ends_on]', D(22))
        await org.check('input[name=confirm_notice]'); await org.click('button:has-text("Save changes")')
        ok = await alert(org, 'being emailed')
        mailed = wait_outbox("to_email='student@thefest.in' and body_text like '%Dates: %→%'")
        check('M4 dates moved (lunch day still inside): saved and holder emailed "Dates: old → new"', ok and mailed)
        await org.goto(f'{B}/organizer/{m4}/settings')
        await org.fill('input[name=name]', 'Bug Fest Renamed')
        nt = await org.locator('[data-testid=change-notice]').inner_text() if await org.locator('[data-testid=change-notice]').count() else ''
        await org.check('input[name=confirm_notice]'); await org.click('button:has-text("Save changes")')
        ok = await alert(org, 'quick check')
        st_row = q(f"select status || '|' || coalesce(review_note,'') || '|' || (approved_at is null)::text from fests where id='{m4}'")
        mailed = wait_outbox("to_email='student@thefest.in' and body_text like '%Name: Bug Fest → Bug Fest Renamed%'")
        check('M4 renaming a live fest with tickets: warned "back to admin review", goes to review with a note, holder emailed',
              'admin review' in nt and ok and st_row.startswith('review|Renamed from') and st_row.endswith('|true') and mailed, (nt, st_row))
        await adm.goto(B + '/admin')
        check('M4 admin sees the renamed fest waiting with the note', 'Renamed from “Bug Fest” to “Bug Fest Renamed”' in await body(adm))
        await org.goto(f'{B}/organizer/{m4}')
        check('M4 organizer dashboard shows why it is waiting', 'Renamed from' in await body(org))
        await org.goto(f'{B}/organizer/{empty}/settings')
        await org.fill('input[name=name]', 'Empty Bug Fest Two')
        n0 = await org.locator('[data-testid=change-notice]').count()
        await org.click('button:has-text("Save changes")')
        ok = await alert(org, 'Saved.')
        check('M4 no tickets sold: rename saves as before (no warning, stays live, no email)', n0 == 0 and ok
              and q(f"select status from fests where id='{empty}'") == 'live' and q("select count(*) from email_outbox where subject like 'Empty Bug Fest%'") == '0')

        # ── L4 past dates ──
        await org.goto(B + '/organizer/new')
        await org.fill('input[name=name]', 'Old Times Fest'); await org.fill('input[name=college]', 'Bug College')
        await org.fill('input[name=starts_on]', '2020-01-01'); await org.fill('input[name=ends_on]', '2020-01-02')
        await org.click('button:has-text("Create fest")')
        check('L4 new fest starting in the past is refused', await alert(org, 'can’t be in the past') and q("select count(*) from fests where name='Old Times Fest'") == '0')
        gr = q("select id from fests where slug='goal-rush'")
        await org.goto(f'{B}/organizer/{gr}/settings')
        await org.fill('textarea[name=description]', 'Thanks for coming! (edited after the fest)')
        await org.click('button:has-text("Save changes")')
        check('L4 editing an existing past fest still works', await alert(org, 'Saved.'))

        # ── M5 non-Latin names ──
        async def create(name):
            await org.goto(B + '/organizer/new')
            await org.fill('input[name=name]', name); await org.fill('input[name=college]', 'RV College')
            await org.fill('input[name=starts_on]', D(40)); await org.fill('input[name=ends_on]', D(41))
            await org.click('button:has-text("Create fest")'); await org.wait_for_url('**/organizer/*?created=1')
            return q(f"select slug from fests where id='{org.url.split('/organizer/')[1].split('?')[0]}'")
        s1 = await create('ನಮ್ಮ ಉತ್ಸವ नमस्ते')
        s2 = await create('ನಮ್ಮ ಉತ್ಸವ नमस्ते')
        s3 = await create('🎉🎉🎉')
        check('M5 Kannada/Hindi fest name → readable link (namma-utsava-namaste), never plain "fest"',
              s1 == 'namma-utsava-namaste' and s2.startswith('namma-utsava-namaste-') and s3.startswith('rv-college-bengaluru'), (s1, s2, s3))

        # ── L5 reset link checked up front ──
        await anon.goto(B + '/reset-password?token=' + 'A' * 43)
        dead = await alert(anon, 'expired or was already used') and await anon.locator('input[name=password]').count() == 0
        tok = 'Bugfix' + 'x' * 37
        q(f"insert into password_resets (token_hash, user_id, expires_at) values ('{hashlib.sha256(tok.encode()).hexdigest()}', '{STU}', now() + interval '1 hour')")
        await anon.goto(B + '/reset-password?token=' + tok)
        live = await anon.locator('input[name=password]').count() == 1
        q(f"update password_resets set used_at = now() where token_hash = '{hashlib.sha256(tok.encode()).hexdigest()}'")
        await anon.goto(B + '/reset-password?token=' + tok)
        used = await alert(anon, 'Ask for a new one') and await anon.locator('input[name=password]').count() == 0
        check('L5 reset page: garbage or used link shows "expired — ask for a new one" before any typing; a good link shows the form', dead and live and used)

        # ── L6 /tickets?sent= only shows a verified name, cut at whole letters ──
        await st.goto(B + '/tickets?sent=Your%20account%20is%20locked%2C%20call%2099999')
        check('L6 /tickets?sent=<any text> shows nothing from the link', 'Ticket sent to' not in await body(st) and 'locked' not in await body(st))
        l6 = mk_fest('bug-l6', 'Transfer Bug Fest', 20, 21)
        l6tt = mk_type(l6)
        l6t = mk_ticket(l6, l6tt, code='TF-BUG6-0001')
        long_kn = 'ಕ್ಷೇತ್ರ' * 30
        mk_user('kannada-long@example.com', long_kn)
        await st.goto(f'{B}/tickets/{l6t}')
        await st.locator('summary:has-text("Transfer this ticket")').click()
        await st.fill('input[name=email]', 'kannada-long@example.com'); await st.check('input[name=confirm]')
        await st.click('button:has-text("Transfer ticket")'); await st.wait_for_url('**/tickets?sent=*')
        shown = await st.locator('.alert', has_text='Ticket sent to').inner_text()
        whole = await st.evaluate('''([shown, full]) => {
            const seg = (s) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
            const name = shown.replace(/^Ticket sent to /, '').replace(/\\. Their new QR.*$/s, '');
            if (!name.endsWith('…')) return false;
            const a = seg(name.slice(0, -1)), b = seg(full);
            return a.length === 60 && a.every((g, i) => g === b[i]);
        }''', [shown, long_kn])
        check('L6 after a real transfer: the name comes from the server, cut to 60 whole letters', whole and 'sent=' + l6t in st.url, shown[:80])

        # ── L1 long unbroken name on /me at 390px ──
        mk_user('long-name@example.com', 'Supercalifragilistic' * 4)
        ln = await login(b, 'long-name@example.com')
        await ln.goto(B + '/me')
        check('L1 /me with an 80-letter unbroken name: no sideways scroll at 390px', await no_sideways(ln))
        await ln.context.close()

        # ── L7 brand budget hints ──
        sp = await login(b, 'sponsor@thefest.in')
        await sp.goto(B + '/sponsor/profile')
        if not await sp.locator('input[name=brand]').input_value(): await sp.fill('input[name=brand]', 'Volt Bug Brand')
        if await sp.locator('select[name=category]').count() and not await sp.locator('select[name=category]').input_value():
            await sp.select_option('select[name=category]', index=1)
        await sp.fill('input[name=budget_min]', '-5'); await sp.click('button:has-text("Save profile")')
        neg = await alert(sp, 'can’t be negative')
        await sp.fill('input[name=budget_min]', '0'); await sp.fill('input[name=budget_max]', '200000000'); await sp.click('button:has-text("Save profile")')
        big = await alert(sp, 'at most ₹1 crore')
        check('L7 brand budget: -5 says "can’t be negative"; ₹20 crore says "at most ₹1 crore"', neg and big)

        # ── L8 Sales paging + L9 no hydration errors ──
        total = int(q(f"select count(*) from orders where fest_id='{gr}' and status in ('paid','refunded')"))
        desk = await login(b, 'organizer@thefest.in', DESKTOP)
        await desk.goto(f'{B}/organizer/{gr}/sales', wait_until='networkidle')
        rows1 = await desk.locator('table').last.locator('tbody tr').count()
        await desk.click('a:has-text("Older →")'); await desk.wait_for_url('**page=2**')
        rows2 = await desk.locator('table').last.locator('tbody tr').count()
        check('L8 Sales shows 50 orders per page with Older/Newer links', total > 50 and rows1 == 50 and rows2 == min(50, total - 50), (total, rows1, rows2))
        desk.errs.clear()
        for w in (1280, 390, 1280):
            await desk.set_viewport_size({'width': w, 'height': 900})
            for path in ('sales', 'sales?page=2', 'sales?q=a', ''):
                await desk.goto(f'{B}/organizer/{gr}/{path}', wait_until='networkidle'); await desk.wait_for_timeout(300)
        check('L9 Goal Rush sales/overview pages: no hydration (#418) or other page errors over 12 loads', not desk.errs, desk.errs[:3])

        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} bug-fix checks passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())

# Team & Roles (v2.7, Oct 24 2026) — docs/team/research/2026-10-24-team-roles.md, acceptance criteria 1–12.
# Runs on the seeded local database and the server on :3000 (run-e2e.sh). AC13 = the whole run-e2e.sh.
import asyncio, os, re, shutil, subprocess, sys, tempfile
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = os.environ.get('E2E_DIR', '/tmp/thefest-e2e') + '/'
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + 'team_roles: ' + name + (f'  [{extra}]' if extra not in ('', None) else ''))
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)

NEON = q("select id from fests where slug='neon-utsav'")
HACK = q("select id from fests where slug='hackverse'")
TODAY = q("select (now() at time zone 'Asia/Kolkata')::date")
TOMORROW = q("select (now() at time zone 'Asia/Kolkata')::date + 1")
mk = lambda em, nm, ver='now()', role='student': q(f"insert into users (email, password_hash, name, role, email_verified_at) select '{em}', password_hash, '{nm}', '{role}', {ver} from users where email='student@thefest.in' on conflict (email) do nothing")
role = lambda fid, em, r, extra_cols='', extra_vals='': q(f"insert into fest_roles (fest_id, email, name, role{extra_cols}) values ('{fid}', '{em}', '', '{r}'{extra_vals}) on conflict do nothing")
mk('deskvol@seed.thefest.in', 'Dina Desk'); role(NEON, 'deskvol@seed.thefest.in', 'desk')
mk('twocounter@seed.thefest.in', 'Tara Two'); role(NEON, 'twocounter@seed.thefest.in', 'vol_gate'); role(NEON, 'twocounter@seed.thefest.in', 'vol_lunch')
mk('dayvol@seed.thefest.in', 'Dev Day'); role(HACK, 'dayvol@seed.thefest.in', 'vol_gate')
role(NEON, 'dayvol@seed.thefest.in', 'vol_gate', ', scope_day', f", '{TOMORROW}'")
q(f"update fests set upi_enabled = true, upi_vpa = coalesce(upi_vpa, 'neonutsav@icici') where id = '{NEON}'")
q(f"update fest_roles set scope_day = '{TOMORROW}' where email = 'judge@seed.thefest.in'")  # "Not today" whatever the seed's clock

# Expected tabs per role (plan 4.2). '' = Overview.
ALL = ['', '/tickets', '/sales', '/analytics', '/payments', '/schedule', '/team', '/announcements', '/sponsors', '/settings']
ACCOUNTS = {
    'owner': ('organizer@thefest.in', ALL, True),
    'co_organizer': ('cohost@seed.thefest.in', ALL, True),
    'finance': ('finance@seed.thefest.in', ['', '/sales', '/analytics', '/payments'], True),
    'sponsorship': ('sponsorlead@seed.thefest.in', ['', '/analytics', '/sponsors'], False),
    'media+judge': ('media@seed.thefest.in', ['', '/analytics', '/schedule', '/announcements'], False),
    'event_head': ('eventhead@seed.thefest.in', ['', '/schedule'], False),
    'desk': ('deskvol@seed.thefest.in', ['/sales'], False),
    'vol_gate': ('volunteer@thefest.in', [], False),
}

async def login(b, email, url='/login', opts=None):
    c = await b.new_context(**(opts or {})); pg = await c.new_page()
    await pg.goto(B + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return c, pg

async def token(c): return next(k['value'] for k in await c.cookies() if k['name'] == 'tf_session')
async def no_hscroll(pg): return await pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── AC6 static guard: no unguarded action/page, and the check really catches one ──
        r = sh(f'node {ROOT}/scripts/check-guards.mjs')
        check('AC6 static guard passes on the code', r.returncode == 0, (r.stdout + r.stderr).strip()[:200])
        tmp = tempfile.mkdtemp()
        try:
            shutil.copytree(f'{ROOT}/src/app/organizer', f'{tmp}/src/app/organizer')
            a = open(f'{tmp}/src/app/organizer/actions.ts').read()
            open(f'{tmp}/src/app/organizer/actions.ts', 'w').write(a.replace("await requirePerm(fd, 'schedule');\n  const { fest } = g;\n  const [e]", "{ fest: { id: s(fd, 'festId') } };\n  const [e]", 1))
            pth = f'{tmp}/src/app/organizer/[festId]/analytics/page.tsx'
            open(pth, 'w').write(open(pth).read().replace('await pageAccess(', 'await Promise.resolve(', 1))
            r = sh(f'GUARD_ROOT={tmp} node {ROOT}/scripts/check-guards.mjs')
            out = r.stdout + r.stderr
            check('AC6 static guard fails on an action without requirePerm (deleteEvent) and a page without pageAccess', r.returncode == 1 and 'deleteEvent' in out and 'analytics/page.tsx' in out, out[:300])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

        # ── AC5 each role sees exactly its tabs; other URLs are not-found / "can't open this tab"; export follows ──
        ctx = {}
        for k, (email, tabs, export) in ACCOUNTS.items():
            c, pg = await login(b, email)
            ctx[k] = (c, pg)
            await pg.goto(f'{B}/organizer/{NEON}/no-access')
            shown = [h.replace(f'/organizer/{NEON}', '') for h in await pg.locator('aside.side a.side-link').evaluate_all('els => els.map(e => e.getAttribute("href"))') if h.startswith(f'/organizer/{NEON}')]
            check(f'AC5 {k}: sees exactly the tabs in the matrix', shown == tabs, shown)
            wrong = []
            for t in ALL:
                res = await pg.goto(f'{B}/organizer/{NEON}{t}')
                denied = pg.url.endswith('/no-access') and 'Your role can’t open this tab' in await pg.inner_text('body')
                if (t in tabs) == denied or res.status != 200: wrong.append((t, res.status, pg.url[-20:]))
            check(f'AC5 {k}: allowed tabs open, every other tab URL says "Your role can’t open this tab"', not wrong, wrong)
            res = await c.request.get(f'{B}/organizer/{NEON}/export')
            check(f'AC5 {k}: export CSV {"allowed" if export else "refused (404)"}', (res.status == 200) == export and (export or res.status == 404), res.status)
        c, pg = await login(b, 'judge@seed.thefest.in')
        res = await pg.goto(f'{B}/organizer/{NEON}')
        check('AC8 day-limited role on another day: no dashboard (404)', res.status == 404, res.status)
        await c.close()
        c, pg = await login(b, 'organizer2@thefest.in')
        res = await pg.goto(f'{B}/organizer/{NEON}/sales')
        check('AC5 an organizer with no role at the fest gets 404', res.status == 404, res.status)
        await c.close()
        fpg = ctx['finance'][1]
        await fpg.goto(f'{B}/organizer/{NEON}/sales')
        check('AC5 finance sees money totals and refund buttons', await fpg.locator('.stat', has_text='Your payout').count() == 1 and await fpg.locator('text=Cancel / refund').count() > 0)
        dpg = ctx['desk'][1]
        await dpg.goto(f'{B}/organizer/{NEON}/sales')
        body = await dpg.inner_text('.main > div.wrap')
        check('desk volunteer: attendee lookup without money (no totals, amounts or refunds)', await dpg.locator('input[name=q]').count() == 1 and '₹' not in body and await dpg.locator('text=Cancel / refund').count() == 0)
        code = q(f"select code from tickets where fest_id='{NEON}' and status='valid' order by code limit 1")
        await dpg.goto(f'{B}/organizer/{NEON}/sales?q={code}')
        check('desk volunteer: finds an attendee by ticket code', code in await dpg.inner_text('.main > div.wrap'), code)
        check('header shows "You: <role>"', 'You: Finance lead' in await fpg.inner_text('[data-you-are]'))

        # ── AC6/AC7 forged forms: an owner's page, submitted with another role's session → refused, DB unchanged ──
        own_c, own = ctx['owner']
        tok = {k: await token(c) for k, (c, _) in ctx.items()}
        order = q(f"select o.id from orders o where o.fest_id='{NEON}' and o.status='paid' and o.addon_for is null and o.provider <> 'upi_direct' and exists (select 1 from tickets t where t.order_id=o.id and t.status='valid') order by o.paid_at desc limit 1")
        F = {  # perm-needing action → (tab, form selector, fill, db probe)
            'fest.edit': ('/settings', 'form:has(textarea[name=description])', [('textarea[name=description]', 'FORGED desc')], "select count(*) from fests where description like 'FORGED%'"),
            'fest.status': ('/settings', 'form:has(input[name=status][value=ended])', [], f"select status from fests where id='{NEON}'"),
            'fest.transfers': ('/settings', 'form:has(input[name=allow])', [], f"select allow_transfers from fests where id='{NEON}'"),
            'fest.cancel': ('/settings', 'form:has(input[name=confirm])', [('input[name=reason]', 'Forged cancel test'), ('input[name=confirm]', 'CANCEL')], f"select status from fests where id='{NEON}'"),
            'ticket.add': ('/tickets', 'form:has(button:has-text("Add ticket type"))', [('input[name=name]', 'Forged Pass'), ('input[name=price]', '1'), ('input[name=quota]', '5')], f"select count(*) from ticket_types where fest_id='{NEON}'"),
            'schedule.add': ('/schedule', 'form:has(button:has-text("Add to schedule"))', [('input[name=title]', 'Forged Event')], f"select count(*) from schedule_events where fest_id='{NEON}'"),
            'announce': ('/announcements', 'form:has(button:has-text("Post announcement"))', [('input[name=title]', 'Forged notice')], f"select count(*) from announcements where fest_id='{NEON}'"),
            'sponsor.add': ('/sponsors', 'form:has(button:has-text("Add sponsor"))', [('input[name=brand]', 'Forged Brand'), ('input[name=email]', 'forged@example.com'), ('input[name=amount]', '100')], f"select count(*) from sponsors where fest_id='{NEON}'"),
            'role.add': ('/team', '#add-role form', [('input[name=email]', 'forged-role@example.com')], f"select count(*) from fest_roles where fest_id='{NEON}'"),
            'role.remove': ('/team', '#team-list .member[data-person="stage@seed.thefest.in"] form:has(button:has-text("Remove"))', [], f"select count(*) from fest_roles where fest_id='{NEON}'"),
            'scanner.reset': ('/team', '#reset-keys form', [], f"select qr_epoch from fests where id='{NEON}'"),
            'upi.settings': ('/payments', 'form:has(input[name=upi_vpa])', [('input[name=upi_vpa]', 'forged@icici')], f"select coalesce(upi_vpa,'') from fests where id='{NEON}'"),
            'upi.paste': ('/payments', 'form:has(textarea[name=alerts])', [('textarea[name=alerts]', 'Rs.123.45 has been credited to your A/c XX1234 UPI Ref No 512345678901')], f"select count(*) from upi_credits where fest_id='{NEON}'"),
            'refund': ('/sales', f'form:has(input[name=orderId][value="{order}"])', [('input[name=reason]', 'Forged refund')], f"select refunded_paise from orders where id='{order}'"),
        }
        NEEDS = {'fest.edit': 'fest', 'fest.status': 'fest', 'fest.transfers': 'fest', 'fest.cancel': 'cancel', 'ticket.add': 'fest', 'schedule.add': 'schedule',
                 'announce': 'announce', 'sponsor.add': 'sponsors', 'role.add': 'team', 'role.remove': 'team', 'scanner.reset': 'team',
                 'upi.settings': 'payments_settings', 'upi.paste': 'payments', 'refund': 'refund'}
        HAS = {'co_organizer': {'fest', 'schedule', 'announce', 'sponsors', 'team', 'payments'}, 'finance': {'payments', 'refund'},
               'sponsorship': {'sponsors'}, 'media+judge': {'schedule', 'announce'}, 'event_head': set(), 'desk': set(), 'vol_gate': set()}

        async def forge(as_token, key):
            tab, sel, fill, probe = F[key]
            c = await b.new_context(); await c.add_cookies([{'name': 'tf_session', 'value': tok['owner'], 'url': B}])
            pg = await c.new_page(); await pg.goto(f'{B}/organizer/{NEON}{tab}')
            if key == 'refund': await pg.locator(f'details:has({sel}) summary').click()
            if key == 'scanner.reset': await pg.click('#reset-keys summary')
            form = pg.locator(sel).first
            for s_, v in fill: await form.locator(s_).fill(v)
            before = q(probe)
            await c.add_cookies([{'name': 'tf_session', 'value': as_token, 'url': B}])   # the forger's own session from here on
            try:
                async with pg.expect_response(lambda r: r.request.method == 'POST', timeout=10000):
                    await form.locator('button[type=submit], button:not([type=button])').last.click()
            except Exception as e:
                print('   (no POST seen)', key, str(e)[:80])
            await asyncio.sleep(0.4)
            after = q(probe)
            await c.close()
            return before, after

        refused_all, tried = [], 0
        for k, perms in HAS.items():
            for key, need in NEEDS.items():
                if need in perms: continue
                tried += 1
                before, after = await forge(tok[k], key)
                if before != after: refused_all.append((k, key, before, after))
        check(f'AC6/AC7 forged forms from every role are refused and change nothing ({tried} tries)', tried > 50 and not refused_all, refused_all)
        before, after = await forge(tok['owner'], 'announce')
        check('control: the same forged-form harness works with the owner’s session', int(after) == int(before) + 1, (before, after))
        q(f"delete from announcements where fest_id='{NEON}' and title='Forged notice'")

        # ── AC7 refunds: owner + Finance lead (Harshith, Oct 24); activity log with the right amount (AC10) ──
        amt_before = int(q(f"select refunded_paise from orders where id='{order}'"))
        await fpg.goto(f'{B}/organizer/{NEON}/sales')
        await fpg.locator(f'details:has(input[name=orderId][value="{order}"]) summary').click()
        f = fpg.locator(f'form:has(input[name=orderId][value="{order}"])')
        await f.locator('input[name=tickets]').fill('1'); await f.locator('input[name=reason]').fill('Asked by student')
        await f.locator('button[type=submit]').click()
        for _ in range(60):  # a fully refunded order's form disappears with its message — watch the database
            if int(q(f"select refunded_paise from orders where id='{order}'")) != amt_before: break
            await asyncio.sleep(0.25)
        amt = int(q(f"select refunded_paise from orders where id='{order}'")) - amt_before
        row = q(f"select actor_email, actor_role, (detail->>'amount')::int from fest_activity where fest_id='{NEON}' and action='refund' order by id desc limit 1").split('|')
        check('AC7 Finance lead can refund', amt > 0, amt)
        check('AC10 refund logged with who (Finance lead) and the same ₹ amount as the order', row[0] == 'finance@seed.thefest.in' and row[1] == 'finance' and int(row[2]) == amt, row)

        # ── AC1 co-organizer rules ──
        cc, co = ctx['co_organizer']
        await co.goto(f'{B}/organizer/{NEON}/team')
        check('AC1 co-organizer: Co-organizer not offered in the role list', await co.locator('select[name=role] option[value=co_organizer]').count() == 0)
        f = co.locator('#add-role form')
        # Oct 24 (Harshith): only the owner makes someone a Finance lead — tests/team_roles_fix1.py forges it
        check('AC1 co-organizer: Finance lead not offered in the role list', await co.locator('select[name=role] option[value=finance]').count() == 0)
        # forge: the select gets a co_organizer option in the browser
        await co.evaluate("() => { const s = document.querySelector('#add-role select[name=role]'); const o = document.createElement('option'); o.value = 'co_organizer'; o.text = 'x'; s.add(o); }")
        await f.locator('input[name=email]').fill('sneaky@seed.thefest.in'); await f.locator('select[name=role]').select_option('co_organizer')
        await f.locator('button[type=submit]').click(); await co.wait_for_selector('#add-role .alert.error', timeout=10000)
        check('AC1 co-organizer cannot add a co-organizer (forged select)', 'Only the fest’s owner' in await co.inner_text('#add-role .alert.error') and q("select count(*) from fest_roles where email='sneaky@seed.thefest.in'") == '0')
        role(NEON, 'organizer2@thefest.in', 'co_organizer')
        await co.reload()
        other = co.locator('#team-list .member[data-person="organizer2@thefest.in"]')
        check('AC1 co-organizer sees no Remove on another co-organizer', await other.locator('button:has-text("Remove")').count() == 0)
        own_page = await (await b.new_context()).new_page(); await own_page.context.add_cookies([{'name': 'tf_session', 'value': tok['owner'], 'url': B}])
        await own_page.goto(f'{B}/organizer/{NEON}/team')
        n0 = q(f"select count(*) from fest_roles where fest_id='{NEON}' and role='co_organizer'")
        frm = own_page.locator('#team-list .member[data-person="organizer2@thefest.in"] form:has(button:has-text("Remove"))')
        await own_page.context.add_cookies([{'name': 'tf_session', 'value': tok['co_organizer'], 'url': B}])
        async with own_page.expect_response(lambda r: r.request.method == 'POST'): await frm.locator('button').click()
        await asyncio.sleep(0.4)
        check('AC1 co-organizer cannot remove another co-organizer (forged form)', q(f"select count(*) from fest_roles where fest_id='{NEON}' and role='co_organizer'") == n0)
        await own_page.context.close()
        check('AC1 nobody can remove the owner: no Remove button on the owner row', await co.locator('#team-list .li[data-person="organizer@thefest.in"]').first.locator('button:has-text("Remove"), button:has-text("Leave")').count() == 0)
        await own.goto(f'{B}/organizer/{NEON}/team')
        f = own.locator('#add-role form')
        await f.locator('input[name=email]').fill('organizer@thefest.in'); await f.locator('button[type=submit]').click()
        await own.wait_for_selector('#add-role .alert.error', timeout=10000)
        check('AC1 the owner can’t be added (or demoted) as a role', 'owner' in await own.inner_text('#add-role .alert.error'))
        await own.locator('#team-list .member[data-person="organizer2@thefest.in"] button:has-text("Remove")').click()
        await own.wait_for_url('**/team?removed=1')
        check('AC1 owner removes a co-organizer', q(f"select count(*) from fest_roles where fest_id='{NEON}' and email='organizer2@thefest.in'") == '0')
        await co.goto(f'{B}/organizer/{NEON}/team')
        await co.locator('#team-list .member[data-person="cohost@seed.thefest.in"] button:has-text("Leave")').click()
        await co.wait_for_url('**/organizer?left=1')
        res = await co.goto(f'{B}/organizer/{NEON}')
        check('AC1 a co-organizer can leave (and then has no access)', res.status == 404 and q("select count(*) from fest_roles where email='cohost@seed.thefest.in'") == '0', res.status)
        role(NEON, 'cohost@seed.thefest.in', 'co_organizer')

        # ── AC2 duplicates / several roles / same role on two days ──
        async def add(pg, email, r, day='', expect=''):
            f = pg.locator('#add-role form')
            old = await pg.evaluate("document.querySelector('#add-role .alert')?.textContent ?? ''")
            await f.locator('input[name=email]').fill(email); await f.locator('select[name=role]').select_option(r)
            await f.locator('select[name=scope_day]').select_option(day)
            await f.locator('button[type=submit]').click()
            await pg.wait_for_function("([o, t]) => { const x = document.querySelector('#add-role .alert')?.textContent ?? ''; return x && x !== o && x.includes(t); }", arg=[old, expect], timeout=10000)
            return await pg.inner_text('#add-role .alert')
        await own.goto(f'{B}/organizer/{NEON}/team')
        await add(own, 'multi@seed.thefest.in', 'media', '', 'Media / PR')
        await add(own, 'multi@seed.thefest.in', 'vol_gate', TODAY, 'Gate volunteer')
        t = await add(own, 'multi@seed.thefest.in', 'vol_gate', TOMORROW, 'Gate volunteer')
        t2 = await add(own, 'multi@seed.thefest.in', 'vol_gate', TODAY, 'already has that role')
        check('AC2 one email holds several roles and the same role on two days', q("select count(*) from fest_roles where email='multi@seed.thefest.in'") == '3', t)
        check('AC2 an exact duplicate is refused with a clear message', 'already has that role on that day' in t2, t2)

        # ── AC3 pending until the email is confirmed ──
        mk('pend@seed.thefest.in', 'Pia Pending', 'null')
        await add(own, 'pend@seed.thefest.in', 'finance', '', 'Pending until they confirm')
        await add(own, 'pend@seed.thefest.in', 'vol_gate', '', 'Pending until they confirm')
        await own.reload()
        st = await own.locator('#team-list .member[data-person="pend@seed.thefest.in"] [data-status]').all_inner_texts()
        nv = await own.locator('#team-list .member[data-person="newvolunteer@seed.thefest.in"] [data-status]').all_inner_texts()
        check('AC3 Team page shows "Pending — email not confirmed" / "no account yet"', st and all('EMAIL NOT CONFIRMED' in x.upper() for x in st) and [x.upper() for x in nv] == ['PENDING — NO ACCOUNT YET'], (st, nv))
        pc, pp = await login(b, 'pend@seed.thefest.in')
        res = await pp.goto(f'{B}/organizer/{NEON}/sales')
        check('AC3 unconfirmed role holder: no tab (404)', res.status == 404, res.status)
        sc, sp_ = await login(b, 'pend@seed.thefest.in', '/scan/login')
        check('AC3 unconfirmed role holder: no scanner ("Confirm your email first")', 'Confirm your email first' in await sp_.inner_text('body'))
        await sc.close()
        q("update users set email_verified_at = now() where email='pend@seed.thefest.in'")
        res = await pp.goto(f'{B}/organizer/{NEON}/sales')
        check('AC3 after confirming: access', res.status == 200 and not pp.url.endswith('/no-access'), pp.url)
        await own.reload()
        check('AC3 Team page now shows Active', 'ACTIVE' in (await own.locator('#team-list .member[data-person="pend@seed.thefest.in"]').inner_text()).upper())

        # ── AC4 removal cuts access on the next request and ends scanner sessions ──
        sc, scn = await login(b, 'pend@seed.thefest.in', '/scan/login')
        check('setup: pending→active volunteer can open the scanner', '/scan' in scn.url and 'login' not in scn.url, scn.url)
        for r_ in ['finance', 'vol_gate']:
            await own.goto(f'{B}/organizer/{NEON}/team')
            await own.locator(f'#team-list .member[data-person="pend@seed.thefest.in"] [data-role-row={r_}] button:has-text("Remove")').click()
            await own.wait_for_url('**/team?removed=1')
        check('AC4 removal message warns about offline keys', 'offline scanner keys' in await own.inner_text('.alert.ok'))
        res = await pp.goto(f'{B}/organizer/{NEON}/sales')
        check('AC4 removed role holder: next click is not found', res.status == 404, res.status)
        r = await scn.evaluate(f"fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{festId:'{NEON}',code:'{code}'}})}}).then(r=>r.status)")
        check('AC4 removed volunteer: scanner refused (401) and sessions ended', r in (401, 403) and q("select count(*) from sessions s join users u on u.id=s.user_id where u.email='pend@seed.thefest.in' and s.kind='scanner'") == '0', r)
        await sc.close(); await pc.close()
        rows = q(f"select action from fest_activity where fest_id='{NEON}' and actor_email='organizer@thefest.in' and action like 'role.%' order by id")
        check('AC10 role add/remove written to the activity log', 'role.add' in rows and 'role.remove' in rows, rows[-80:])

        # ── AC8 scanner counters ──
        used = q(f"select code from tickets where fest_id='{NEON}' and status='used' limit 1")
        tc, tp = await login(b, 'twocounter@seed.thefest.in', '/scan/login')
        await tp.goto(f'{B}/scan?fest={NEON}')
        opts = await tp.locator('select[aria-label=Counter] option').evaluate_all('els => els.map(e => e.value)')
        check('AC8 Gate + Lunch volunteer can switch only between those two', opts == ['gate', 'lunch'], opts)
        sj = lambda c: f"fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{festId:'{NEON}',counter:'{c}',code:'{used}'}})}}).then(r=>r.json())"
        r1 = await tp.evaluate(sj('stay')); r2 = await tp.evaluate(sj('lunch'))
        check('AC8 a counter outside their roles is not used (stay → gate); their own works (lunch)', r1.get('counter') == 'gate' and r2.get('counter') == 'lunch', (r1.get('counter'), r2.get('counter')))
        k = await tp.evaluate(f"fetch('/api/scan/keys?festId={NEON}').then(r=>r.json())")
        check('AC8 Gate + Lunch volunteer gets only gate + lunch sealed keys', k.get('roles') == ['gate', 'lunch'], k.get('roles'))
        await tc.close()
        dc, dp = await login(b, 'deskvol@seed.thefest.in', '/scan/login')
        k = await dp.evaluate(f"fetch('/api/scan/keys?festId={NEON}').then(r=>r.json())")
        check('AC8 desk volunteer scans at the gate (gate keys only)', k.get('roles') == ['gate'], k.get('roles'))
        await dc.close()
        fc, fp = await login(b, 'finance@seed.thefest.in', '/scan/login')
        check('AC8 Finance lead gets no scanner (no sealed sections)', 'login' in fp.url and 'not on any fest' in await fp.inner_text('body'))
        await fc.close()
        cc2, cp2 = await login(b, 'cohost@seed.thefest.in', '/scan/login')
        k = await cp2.evaluate(f"fetch('/api/scan/keys?festId={NEON}').then(r=>r.json())")
        check('AC8 co-organizer gets every counter + the organizer section', k.get('roles') == ['gate', 'lunch', 'stay', 'org'], k.get('roles'))
        await cc2.close()
        yc, yp = await login(b, 'dayvol@seed.thefest.in', '/scan/login')
        r = await yp.evaluate(f"fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{festId:'{NEON}',code:'{used}'}})}}).then(async r=>({{s:r.status,j:await r.json()}}))")
        k = await yp.evaluate(f"fetch('/api/scan/keys?festId={NEON}').then(r=>r.status)")
        check('AC8 day-limited volunteer on another day: scan 403 "Your shift is on …", no keys', r['s'] == 403 and 'Your shift is on' in r['j'].get('error', '') and k == 403, (r, k))
        await yc.close()
        jc, jp = await login(b, 'judge@seed.thefest.in')
        await own.goto(f'{B}/organizer/{NEON}/team')
        check('AC8 Team page shows "Not today" for a role on another day', 'NOT TODAY' in (await own.locator('#team-list .member[data-person="judge@seed.thefest.in"]').inner_text()).upper())
        await jc.close()

        # ── AC10 activity viewer: owner + co-organizers only, newest first, no edit/delete ──
        await own.goto(f'{B}/organizer/{NEON}/settings')
        f = own.locator('form:has(textarea[name=description])')
        await f.locator('textarea[name=description]').fill('Three nights of pro shows (edited by the team test).')
        await f.locator('button[type=submit]').click(); await own.wait_for_selector('.alert.ok', timeout=10000)
        check('AC10 fest edit logged', q(f"select count(*) from fest_activity where fest_id='{NEON}' and action='fest.edit' and actor_role='owner'") not in ('', '0'))
        await own.goto(f'{B}/organizer/{NEON}/team')
        first = await own.locator('[data-activity-row]').first.inner_text()
        check('AC10 viewer: newest first, who (name, role), IST time', 'Edited fest details' in first and 'Riya Kapoor (Owner)' in first and re.search(r'\d{1,2}:\d{2}', first), first)
        check('AC10 viewer is append-only (only the filter form in it)', await own.locator('#activity form').count() == 1 and await own.locator('#activity form[method=get]').count() == 1)
        await own.goto(f'{B}/organizer/{NEON}/team?type=refund#activity')
        t = await own.inner_text('#activity')
        check('AC10 type filter (refunds) shows the Finance lead’s refund', 'Refunded 1 ticket' in t and 'Finance lead' in t and 'Edited fest details' not in t, t[:200])
        await own.goto(f'{B}/organizer/{NEON}/team?type=scans#activity')
        check('AC10 "Scans" filter reads the scan log', await own.locator('[data-scan-log] > div').count() > 0)
        c_, cpg = await login(b, 'cohost@seed.thefest.in')
        await cpg.goto(f'{B}/organizer/{NEON}/team')
        check('AC10 co-organizer sees the activity log', await cpg.locator('#activity').count() == 1)
        await c_.close()
        await fpg.goto(f'{B}/organizer/{NEON}/team')
        check('AC10 Finance lead can’t open the Team tab / log', fpg.url.endswith('/no-access'))

        # ── AC11 "My fest roles" on /me; leave a role ──
        mc, me = await login(b, 'media@seed.thefest.in', opts=MOBILE)
        await me.goto(f'{B}/me')
        card = me.locator('[data-my-roles] [data-fest-role="Neon Utsav"]')
        txt = await card.inner_text()
        check('AC11 /me lists fest roles with status', all(w in txt.upper() for w in ['MEDIA / PR', 'JUDGE', 'ACTIVE']), txt[:160])
        href = await card.locator('a:has-text("Open dashboard")').get_attribute('href')
        check('AC11 "Open dashboard" lands on the first allowed tab', href == f'/organizer/{NEON}', href)
        check('AC12 /me with roles fits 390px', await no_hscroll(me)); await me.screenshot(path=SHOTS + 'team_roles_me_390.png', full_page=True)
        await card.locator('[data-status]').first.wait_for()
        jrow = card.locator('div.row:has(.badge:has-text("Judge"))')
        await jrow.locator('summary:has-text("Leave role")').click(); await jrow.locator('button:has-text("Yes, leave")').click()
        await me.wait_for_url('**/me?left=1')
        check('AC11 leaving a role works', q("select count(*) from fest_roles where email='media@seed.thefest.in' and role='judge'") == '0'
              and q(f"select count(*) from fest_activity where action='role.leave' and actor_email='media@seed.thefest.in'") == '1')
        sc, scn = await login(b, 'volunteer@thefest.in', opts=MOBILE)
        await scn.goto(f'{B}/me')
        check('AC11 volunteer: "Open scanner" and no dashboard button', await scn.locator('[data-my-roles] a:has-text("Open scanner")').count() >= 1 and await scn.locator('[data-fest-role="Neon Utsav"] a:has-text("Open dashboard")').count() == 0)
        await sc.close(); await mc.close()

        # ── AC12 390px: Team page, role-limited dashboard ──
        oc, op = await login(b, 'organizer@thefest.in', opts=MOBILE)
        await op.goto(f'{B}/organizer/{NEON}/team')
        check('AC12 Team page fits 390px', await no_hscroll(op)); await op.screenshot(path=SHOTS + 'team_roles_team_390.png', full_page=True)
        await oc.close()
        fc, fp = await login(b, 'finance@seed.thefest.in', opts=MOBILE)
        await fp.goto(f'{B}/organizer/{NEON}/sales')
        chips = await fp.locator('.tabstrip a.chip').all_inner_texts()
        check('AC12 Finance dashboard at 390px: only its tabs, no sideways scroll', len(chips) == 4 and await no_hscroll(fp), chips)
        await fp.screenshot(path=SHOTS + 'team_roles_finance_390.png', full_page=True)
        await fc.close()

        # ── AC9 migration: v2.7 on an old database (before v2.7) copies members/staff once, twice-safe ──
        OLD = 'psql -h /tmp -U postgres tf_v26'
        sh('dropdb -h /tmp -U postgres --if-exists tf_v26 && createdb -h /tmp -U postgres tf_v26')
        sh(f'cd {ROOT} && git show eaf8018:db/schema.sql > /tmp/tf_v26.sql && {OLD} -q -f /tmp/tf_v26.sql')
        q("insert into users (email, password_hash, name, role, email_verified_at) values ('o@x.in','x','Owner','organizer',now()), ('co@x.in','x','Co','organizer',now())", OLD)
        q("insert into fests (slug, organizer_id, name, college, city, category, starts_on, ends_on) select 'oldfest', id, 'Old Fest', 'C', 'B', 'cultural', current_date, current_date + 1 from users where email='o@x.in'", OLD)
        q("insert into fest_members (fest_id, email) select id, 'co@x.in' from fests", OLD)
        q("insert into fest_staff (fest_id, email, name, duty, can_scan) select id, e, n, d, s from fests, (values ('g@x.in','G','Gate 2',true), ('l@x.in','L','Lunch counter',true), ('h@x.in','H','Hostel desk',true), ('m@x.in','M','Main stage',false)) v(e,n,d,s)", OLD)
        r1 = sh(f'{OLD} -q -v ON_ERROR_STOP=1 -f {ROOT}/db/schema.sql')
        got1 = q("select string_agg(email || ':' || role || ':' || can_scan, ',' order by email) from fest_roles", OLD)
        r2 = sh(f'{OLD} -q -v ON_ERROR_STOP=1 -f {ROOT}/db/schema.sql')
        got2 = q("select string_agg(email || ':' || role || ':' || can_scan, ',' order by email) from fest_roles", OLD)
        check('AC9 v2.7 applies on an old database, twice', r1.returncode == 0 and r2.returncode == 0, (r1.stderr + r2.stderr)[:200])
        check('AC9 co-organizers and volunteers become roles with the same counter', got1 == 'co@x.in:co_organizer:true,g@x.in:vol_gate:true,h@x.in:vol_stay:true,l@x.in:vol_lunch:true,m@x.in:vol_gate:false', got1)
        check('AC9 second run: same rows, old tables kept', got1 == got2 and q("select count(*) from fest_members", OLD) == '1' and q("select count(*) from fest_staff", OLD) == '4', got2)
        q("delete from fest_roles where email='g@x.in'", OLD)
        sh(f'{OLD} -q -f {ROOT}/db/schema.sql')
        check('AC9 re-running never brings back a role removed after v2.7', q("select count(*) from fest_roles where email='g@x.in'", OLD) == '0')
        sh('dropdb -h /tmp -U postgres --if-exists tf_v26')
        check('AC9 the seeded lunch volunteer still scans lunch only (migrated counter)', q("select role from fest_roles where email='lunch@seed.thefest.in'") == 'vol_lunch')

        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\nteam_roles: {len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed or not results else 0)

asyncio.run(main())

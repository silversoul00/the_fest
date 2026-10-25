# Team & Roles fix round 1 (Oct 24, 2026): docs/team/reviews/2026-10-24-team-roles-review-1.md and -test-1.md.
# Only the owner makes a Finance lead; nobody adds a role to their own email; no ₹ for non-money roles (Analytics and every
# tab); CSV/Sales links only with the permission; scanner link only for scanning roles, named by counter; 390px scanner
# header; /me banner wording; "Only on this day" list; owner's extra roles on the Owner card; no check-in for pending
# people; every seeded role holder can log in; db/demo-seed.sql loads on a fresh database.
# Runs on the seeded local database and the server on :3000 (run-e2e.sh), after tests/team_roles.py.
import asyncio, os, re, subprocess
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + 'team_roles_fix1: ' + name + (f'  [{extra}]' if extra not in ('', None) else ''))
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)

NEON = q("select id from fests where slug='neon-utsav'")
mk = lambda em, nm, ver='now()': q(f"insert into users (email, password_hash, name, role, email_verified_at) select '{em}', password_hash, '{nm}', 'student', {ver} from users where email='student@thefest.in' on conflict (email) do nothing")
role = lambda em, r: q(f"insert into fest_roles (fest_id, email, name, role) values ('{NEON}', '{em}', '', '{r}') on conflict do nothing")
# Accounts this file relies on (team_roles.py may have moved some around)
role('cohost@seed.thefest.in', 'co_organizer')
mk('fx_two@seed.thefest.in', 'Tanu Two'); role('fx_two@seed.thefest.in', 'vol_gate'); role('fx_two@seed.thefest.in', 'vol_lunch')
mk('fx_desk@seed.thefest.in', 'Dhruv Desk'); role('fx_desk@seed.thefest.in', 'desk')
mk('fx_media@seed.thefest.in', 'Mira Media'); role('fx_media@seed.thefest.in', 'media')
mk('fx_event@seed.thefest.in', 'Eshan Events'); role('fx_event@seed.thefest.in', 'event_head')
role('lunch@seed.thefest.in', 'vol_lunch')
q(f"insert into fest_roles (fest_id, email, name, role, duty) select '{NEON}', 'organizer@thefest.in', 'Riya Kapoor', 'vol_gate', 'Gate 1' where not exists (select 1 from fest_roles where fest_id='{NEON}' and email='organizer@thefest.in')")
MAIN = '.main > div.wrap'

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
        oc, own = await login(b, 'organizer@thefest.in')
        cc, co = await login(b, 'cohost@seed.thefest.in')
        tok_own, tok_co = await token(oc), await token(cc)

        # ── Review #1: only the owner makes a Finance lead; nobody adds a role to their own email ──
        async def add(pg, email, r, inject=False):
            await pg.goto(f'{B}/organizer/{NEON}/team'); await pg.wait_for_load_state('networkidle')
            if inject:  # forged form: the option the page doesn't offer
                await pg.evaluate("r => { const s = document.querySelector('#add-role select[name=role]'); const o = document.createElement('option'); o.value = r; o.text = r; s.add(o); }", r)
            f = pg.locator('#add-role form')
            await f.locator('input[name=email]').fill(email); await f.locator('select[name=role]').select_option(r)
            await f.locator('button[type=submit]').click()
            await pg.wait_for_selector('#add-role .alert', timeout=10000)
            return await pg.inner_text('#add-role .alert')
        n = lambda em, r: q(f"select count(*) from fest_roles where fest_id='{NEON}' and email='{em}' and role='{r}'")
        await co.goto(f'{B}/organizer/{NEON}/team')
        check('#1 co-organizer: Finance lead not in the role list', await co.locator('select[name=role] option[value=finance]').count() == 0)
        t = await add(co, 'fx_fin_friend@seed.thefest.in', 'finance', inject=True)
        check('#1 co-organizer forging Finance lead for a friend: refused, no row', 'Only the fest’s owner can add a Finance lead' in t and n('fx_fin_friend@seed.thefest.in', 'finance') == '0', t)
        t = await add(co, 'cohost@seed.thefest.in', 'finance', inject=True)
        check('#1 co-organizer forging Finance lead for themselves: refused, no row', 'Only the fest’s owner' in t and n('cohost@seed.thefest.in', 'finance') == '0', t)
        for r in ['media', 'vol_gate', 'sponsorship', 'judge']:
            t = await add(co, 'COHOST@seed.thefest.in', r)
            check(f'#1 co-organizer adding themselves as {r}: refused ("own email"), no row', 'your own email' in t and n('cohost@seed.thefest.in', r) == '0', t)
        t = await add(own, 'fx_owner_fin@seed.thefest.in', 'finance')
        check('#1 the owner can still add a Finance lead', n('fx_owner_fin@seed.thefest.in', 'finance') == '1', t)
        # A Finance lead row: co-organizer has no Remove on it, and a forged remove is refused
        await own.goto(f'{B}/organizer/{NEON}/team')
        frm = own.locator('#team-list .member[data-person="fx_owner_fin@seed.thefest.in"] form:has(button:has-text("Remove"))')
        await own.context.add_cookies([{'name': 'tf_session', 'value': tok_co, 'url': B}])
        async with own.expect_response(lambda r: r.request.method == 'POST'): await frm.locator('button').click()
        await asyncio.sleep(0.4)
        await own.context.add_cookies([{'name': 'tf_session', 'value': tok_own, 'url': B}])
        check('#1 co-organizer can’t remove a Finance lead (forged form)', n('fx_owner_fin@seed.thefest.in', 'finance') == '1')

        # ── F1 / #3: no ₹ for roles without money; CSV only with export; Sales link only with Sales ──
        ROLES = {'sponsorship': 'sponsorlead@seed.thefest.in', 'media': 'fx_media@seed.thefest.in', 'event_head': 'fx_event@seed.thefest.in', 'desk': 'fx_desk@seed.thefest.in'}
        ctx = {}
        for k, em in ROLES.items():
            c, pg = await login(b, em); ctx[k] = (c, pg)
            await pg.goto(f'{B}/organizer/{NEON}/no-access')
            tabs = [h for h in await pg.locator('aside.side a.side-link').evaluate_all('els => els.map(e => e.getAttribute("href"))') if h.startswith(f'/organizer/{NEON}')]
            leaks = []
            for h in tabs:
                if k == 'sponsorship' and h.endswith('/sponsors'): continue  # sponsorship deal amounts are their own work, not ticket revenue
                await pg.goto(B + h)
                if '₹' in await pg.inner_text(MAIN): leaks.append(h)
            check(f'F1 {k}: no ₹ on any tab they can open ({len(tabs)} tabs)', tabs and not leaks, leaks)
        for k in ['sponsorship', 'media']:
            pg = ctx[k][1]
            await pg.goto(f'{B}/organizer/{NEON}/analytics')
            body = await pg.inner_text(MAIN)
            check(f'F1 {k} Analytics: no revenue/refund ₹, no CSV button, no Sales link', '₹' not in body and 'revenue' not in body.lower()
                  and await pg.locator(f'{MAIN} a[href$="/export"]').count() == 0 and await pg.locator(f'{MAIN} a[href$="/sales"]').count() == 0, body[:200])
            check(f'F1 {k} Analytics still shows tickets and footfall', 'TICKETS SOLD' in body.upper() and 'SHOWED UP' in body.upper())
        fc, fpg = await login(b, 'finance@seed.thefest.in')
        await fpg.goto(f'{B}/organizer/{NEON}/analytics')
        body = await fpg.inner_text(MAIN)
        check('F1 control: Finance lead Analytics shows revenue ₹ and the CSV button', 'YOUR REVENUE' in body.upper() and '₹' in body and await fpg.locator(f'{MAIN} a[href$="/export"]').count() == 1)

        # ── F2: scanner link only for scanning roles, named by counter ──
        async def scan_links(pg):
            await pg.goto(f'{B}/organizer/{NEON}/no-access')
            return [' '.join(x.split()).replace('📷 ', '').lower() for x in await pg.locator('[data-scanner-link]').all_inner_texts()]
        for k, pg in [('finance', fpg), ('sponsorship', ctx['sponsorship'][1]), ('media', ctx['media'][1])]:
            got = await scan_links(pg)
            check(f'F2 {k}: no scanner link in the sidebar or on the no-access page', got == [], got)
        got = await scan_links(ctx['event_head'][1])   # v2.8 (Oct 25): event heads work the Event counter
        check('F2 event_head: "Event scanner"', got == ['event scanner', 'open event scanner'], got)
        got = await scan_links(ctx['desk'][1])
        check('F2 desk volunteer: "Gate scanner"', got == ['gate scanner', 'open gate scanner'], got)
        lc, lp = await login(b, 'lunch@seed.thefest.in')
        got = await scan_links(lp)
        check('F2 lunch volunteer: "Lunch scanner"', got == ['lunch scanner', 'open lunch scanner'], got)
        await lc.close()
        got = await scan_links(own)
        check('F2 owner (every counter): just "Scanner"', got == ['scanner', 'open scanner'], got)
        tc, tp = await login(b, 'fx_two@seed.thefest.in')
        got = await scan_links(tp)
        check('F2 gate + lunch volunteer: just "Scanner"', got == ['scanner', 'open scanner'], got)
        await tc.close()

        # ── W1: scanner header at 390px with the counter picker ──
        for em in ['fx_two@seed.thefest.in', 'organizer@thefest.in']:
            mc, mp = await login(b, em, '/scan/login', MOBILE)
            await mp.goto(f'{B}/scan?fest={NEON}'); await mp.wait_for_selector('[data-counter]')
            box = await mp.locator('[data-counter]').bounding_box()
            check(f'W1 390px scanner heading on one line beside/above the counter picker ({em.split("@")[0]})',
                  box and box['height'] < 50 and box['width'] > 60 and await mp.locator('select[aria-label=Counter]').count() == 1 and await no_hscroll(mp), box)
            await mc.close()

        # ── W2: /me banner wording ──
        mk('fx_unver@seed.thefest.in', 'Uma Unconfirmed', 'null'); role('fx_unver@seed.thefest.in', 'judge')
        uc, up = await login(b, 'fx_unver@seed.thefest.in')
        await up.goto(f'{B}/me')
        t = await up.inner_text('.verify-notice')
        check('W2 confirm-email banner names the new roles', 'Any fest role' in t and 'finance' in t and 'gate team, sponsor dashboard' not in t, t)
        await uc.close()

        # ── W3: "Only on this day" is a list of whole fest days (never a half-filled date) ──
        await own.goto(f'{B}/organizer/{NEON}/team')
        opts = await own.locator('#add-role select[name=scope_day] option').evaluate_all('els => els.map(e => e.value)')
        s, e = q(f"select starts_on || ' ' || ends_on from fests where id='{NEON}'").split()
        check('W3 day field starts empty ("Every fest day") and offers only full fest dates', opts and opts[0] == '' and len(opts) > 1
              and all(re.fullmatch(r'\d{4}-\d{2}-\d{2}', d) and s <= d <= e for d in opts[1:]) and await own.locator('#add-role input[type=date]').count() == 0, opts)

        # ── M1: owner's extra role is on the Owner card; co-organizers can't remove it ──
        await own.goto(f'{B}/organizer/{NEON}/team')
        cards = own.locator('#team-list [data-person="organizer@thefest.in"]')
        check('M1 owner appears once, extra role (Gate volunteer) under the Owner card', await cards.count() == 1
              and 'OWNER' in (await cards.inner_text()).upper() and await cards.locator('[data-role-row=vol_gate]').count() == 1)
        await co.goto(f'{B}/organizer/{NEON}/team')
        oc_card = co.locator('#team-list [data-person="organizer@thefest.in"]')
        check('M1 co-organizer sees no Remove on the owner’s roles', await oc_card.locator('button:has-text("Remove")').count() == 0)
        orow = q(f"select id from fest_roles where fest_id='{NEON}' and email='organizer@thefest.in' and role='vol_gate'")
        frm = own.locator(f'#team-list [data-person="organizer@thefest.in"] form:has(button:has-text("Remove"))').first
        check('setup: owner sees Remove on their own extra role', await frm.count() == 1)
        await own.context.add_cookies([{'name': 'tf_session', 'value': tok_co, 'url': B}])
        async with own.expect_response(lambda r: r.request.method == 'POST'): await frm.locator('button').click()
        await asyncio.sleep(0.4)
        await own.context.add_cookies([{'name': 'tf_session', 'value': tok_own, 'url': B}])
        check('M1 co-organizer can’t remove the owner’s role (forged form)', q(f"select count(*) from fest_roles where id='{orow}'") == '1')

        # ── M2: no "Check in" for pending people (and a forged check-in does nothing) ──
        await own.goto(f'{B}/organizer/{NEON}/team')
        pend = own.locator('#team-list .member[data-person="newvolunteer@seed.thefest.in"]')
        check('M2 pending person: no "Check in" button', await pend.count() == 1 and await pend.locator('button:has-text("Check in")').count() == 0)
        pid = q(f"select id from fest_roles where fest_id='{NEON}' and email='newvolunteer@seed.thefest.in'")
        q(f"update fest_roles set checked_in_at = null where id='{pid}'")
        f = own.locator('#team-list .member[data-person="lunch@seed.thefest.in"] form:has(button.btn.sm:not(.text))').first
        await f.evaluate("(f, id) => { f.querySelector('input[name=id]').value = id; }", pid)
        async with own.expect_response(lambda r: r.request.method == 'POST'): await f.locator('button').click()
        await asyncio.sleep(0.4)
        check('M2 forged check-in of a pending person changes nothing', q(f"select checked_in_at is null from fest_roles where id='{pid}'") == 't')

        # ── M3: every seeded role holder can log in with password123 ──
        for em in ['gate2@seed.thefest.in', 'gate3@seed.thefest.in', 'desk@seed.thefest.in', 'stage@seed.thefest.in']:
            c, pg = await login(b, em)
            check(f'M3 seeded {em.split("@")[0]}@ logs in (password123, email confirmed)', '/login' not in pg.url
                  and q(f"select email_verified_at is not null from users where email='{em}'") == 't', pg.url)
            await c.close()
        check('M3 only newvolunteer@ is left without an account', q(f"select string_agg(distinct r.email, ',') from fest_roles r left join users u on u.email = r.email where u.id is null and r.email like '%@seed.thefest.in' and r.email not like 'fx_%' and r.email not in ('multi@seed.thefest.in','sneaky@seed.thefest.in','forged-role@example.com','fx_owner_fin@seed.thefest.in')") == 'newvolunteer@seed.thefest.in')

        for c, _ in ctx.values(): await c.close()
        for c in [oc, cc, fc]: await c.close()
        await b.close()

    # ── M3: db/schema.sql + db/demo-seed.sql load on a fresh database (the preview/demo seed) ──
    D = 'psql -h /tmp -U postgres tf_demo_fix1'
    sh('dropdb -h /tmp -U postgres --if-exists tf_demo_fix1 && createdb -h /tmp -U postgres tf_demo_fix1')
    r1 = sh(f'{D} -q -v ON_ERROR_STOP=1 -f {ROOT}/db/schema.sql')
    r2 = sh(f'{D} -q -v ON_ERROR_STOP=1 -f {ROOT}/db/demo-seed.sql')
    check('M3 demo seed loads on a fresh database', r1.returncode == 0 and r2.returncode == 0, (r1.stderr + r2.stderr)[:300])
    got = q("select string_agg(r.email, ',' order by r.email) from (select distinct email from fest_roles) r left join users u on u.email = r.email where u.id is null or u.email_verified_at is null", D)
    check('M3 demo seed: every role holder has a confirmed account except newvolunteer@', got == 'newvolunteer@seed.thefest.in', got)
    sh('dropdb -h /tmp -U postgres --if-exists tf_demo_fix1')

    bad = [n for n, ok in results if not ok]
    print(f'team_roles_fix1: {len(results) - len(bad)}/{len(results)} passed')
    if bad: raise SystemExit(1)

asyncio.run(main())

# Re-test of the Oct 23 bug-hunt fixes (docs/team/reviews/2026-10-23-bugfix-test-1.md): gaps found by hand.
# Main server on :3000 with the seeded database. Runs after bugfix_oct23.py; makes its own fest.
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright

B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()

async def login(b, email):
    ctx = await b.new_context(**MOBILE); pg = await ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200])); pg.errs = errs
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

ORG = q("select id from users where email='organizer@thefest.in'")
STU = q("select id from users where email='student@thefest.in'")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # ── M4: an approved live fest with tickets sold must not be renamed into a different live fest without review,
        #    also not by Unpublish → rename → Publish ──
        fid = q(f"""insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, status, approved_at)
                    values ('retest-bypass-fest', '{ORG}', 'Retest Bypass Fest', 'Bug College', 'Bengaluru', 'Hall A', 'cultural',
                            current_date + 20, current_date + 21, 'live', now()) returning id""").split('\n')[0]
        tt = q(f"insert into ticket_types (fest_id, name, price_paise, quota, sold) values ('{fid}', 'Day Pass', 10000, 100, 1) returning id").split('\n')[0]
        oid = q(f"insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, status, provider, paid_at) values ('{STU}', '{fid}', '{tt}', 1, 10000, 'paid', 'demo', now()) returning id").split('\n')[0]
        q(f"insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name) select 'TF-RTST-0001', '{oid}', '{STU}', '{fid}', '{tt}', name from users where id='{STU}'")
        org = await login(b, 'organizer@thefest.in')
        await org.goto(f'{B}/organizer/{fid}/settings')
        await org.click('form:has(input[name=status][value=draft]) button'); await org.wait_for_load_state('networkidle')
        await org.goto(f'{B}/organizer/{fid}/settings')
        await org.fill('form:has(input[name=venue]) input[name=name]', 'Totally Different Fest')
        if await org.locator('input[name=confirm_notice]').count(): await org.check('input[name=confirm_notice]')
        await org.click('form:has(input[name=venue]) button[type=submit]')
        await org.locator('.alert', has_text='Saved').first.wait_for(timeout=10000)
        await org.goto(f'{B}/organizer/{fid}/settings')
        await org.click('form:has(input[name=status][value=live]) button'); await org.wait_for_load_state('networkidle')
        st = q(f"select status || '|' || name from fests where id='{fid}'")
        check('M4 Unpublish → rename → Publish (tickets sold) goes to admin review, not straight live', st == 'review|Totally Different Fest', st)

        # ── L8: a page number past the end is not shown as "page 1000 of 2" ──
        gr = q("select id from fests where slug='goal-rush'")
        await org.goto(f'{B}/organizer/{gr}/sales?page=99999', wait_until='networkidle')
        nav = ' '.join(await org.locator('nav[aria-label=Pages]').all_inner_texts())
        check('L8 Sales ?page=99999 shows the last real page (no "page 1000 of 2", no empty list)', 'page 1000' not in nav and 'No sales yet' not in await org.locator('body').inner_text(), nav)

        # ── L9: Sales has no hydration error (#418) — 60 loads, it showed up in ~3-7% of loads ──
        org.errs.clear()
        for i in range(60):
            await org.goto(f'{B}/organizer/{gr}/sales' + ('?page=2' if i % 2 else ''), wait_until='networkidle')
        check('L9 Goal Rush Sales: no hydration (#418) over 60 loads', not org.errs, (len(org.errs), org.errs[:1]))

        # ── H1 follow-up: a ?next= with non-ASCII characters must not crash (500 / "Something went wrong") ──
        for n in ['/fests/%E0%B2%A8', '/%E2%80%8B/x', '/%EF%BC%8F/x']:
            r = await org.request.get(f'{B}/login?next={n}', max_redirects=0)
            check(f'H1 logged-in /login?next={n} → redirect on THE FEST, not 500', r.status in (302, 303, 307, 308) and r.headers.get('location', '').startswith('/'), (r.status, r.headers.get('location')))
        anon = await (await b.new_context(**MOBILE)).new_page()
        await anon.goto(B + '/login?next=/fests/%E0%B2%A8')
        await anon.fill('input[name=email]', 'student@thefest.in'); await anon.fill('input[name=password]', 'password123')
        await anon.click('button[type=submit]'); await anon.wait_for_timeout(4000)
        check('H1 log in with a non-ASCII ?next= → no error page', 'Something went wrong' not in await anon.locator('body').inner_text(), anon.url)

        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} bug-fix re-test checks passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())

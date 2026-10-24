# Organizer analytics: renders for owner, hidden from other organizers, empty state, table views.
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()

async def login(b, email):
    pg = await (await b.new_context(viewport={'width': 1280, 'height': 900})).new_page()
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        nu = q("select id from fests where slug='neon-utsav'")
        cb = q("select id from fests where slug='campus-beats'")
        org = await login(b, 'organizer@thefest.in')
        errs = []; org.on('pageerror', lambda e: errs.append(str(e)))
        await org.goto(f'{B}/organizer/{nu}'); await org.click('a:has-text("Analytics")'); await org.wait_for_url('**/analytics')
        check('Analytics tab opens', await org.locator('h1:has-text("Analytics")').count() == 1)
        sold = q(f"select count(*) from tickets where fest_id='{nu}' and status<>'void'")
        check('tickets-sold tile matches the database', (await org.locator('.stat', has_text='Tickets sold').locator('.v').text_content()).replace(',', '') == sold, sold)
        check('all chart sections render', all([await org.locator(f'.h3:has-text("{t}")').count() == 1 for t in ['Sales pace', 'Ticket types', 'Gate entries by hour', 'Where your audience comes from', 'When students buy', 'How people paid', 'Blocked at the gate']]))
        entered = q(f"select count(*) from scans where fest_id='{nu}' and result='admitted'")
        await org.locator('section:has-text("Gate entries by hour") summary').first.click()
        rows = await org.locator('section:has-text("Gate entries by hour") .viz-table').first.locator('tbody td.n').all_text_contents()
        check('gate table adds up to all entries', sum(int(r.replace(',', '')) for r in rows) == int(entered), (rows, entered))
        await org.locator('.viz-area').first.scroll_into_view_if_needed()
        box = await org.locator('.viz-area').first.bounding_box()
        await org.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] / 2)
        check('hovering the sales chart shows a tooltip', await org.locator('.viz-tip').count() == 1)
        await org.keyboard.press('Tab')
        check('no page errors', not errs, errs)
        r = await org.goto(f'{B}/organizer/{cb}/analytics')
        check('another organizer\'s fest analytics is hidden', r.status == 404)
        o2 = await login(b, 'organizer2@thefest.in')
        await o2.goto(f'{B}/organizer/{cb}/analytics')
        check('fest with no sales shows the empty state', await o2.locator('text=No sales yet').count() == 1)
        await b.close()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} analytics checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

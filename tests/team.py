# Ticket transfer + co-organizers.
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()

async def login(b, email):
    pg = await (await b.new_context()).new_page()
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def err(pg):
    await pg.wait_for_selector('.alert.error'); return await pg.text_content('.alert.error')

async def transfer(pg, email, confirm=True):
    await pg.fill('input[name=email]', email)
    if confirm and not await pg.is_checked('input[name=confirm]'): await pg.check('input[name=confirm]')
    await pg.click('text=Transfer ticket')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        hv = q("select id from fests where slug='hackverse'")
        tid = q(f"select t.id from tickets t join users u on u.id=t.user_id where u.email='student@thefest.in' and t.fest_id='{hv}' and t.status='valid' limit 1")
        old_code = q(f"select code from tickets where id='{tid}'")

        # ── Transfer ──
        st = await login(b, 'student@thefest.in')
        await st.goto(f'{B}/tickets/{tid}')
        await st.click('text=Transfer this ticket to a friend')
        await transfer(st, 'nobody-xyz@example.com')
        check('transfer to unknown email refused', 'sign up first' in await err(st))
        await transfer(st, 'organizer@thefest.in')
        check('transfer to organizer account refused', 'student accounts' in await err(st))
        await st.uncheck('input[name=confirm]'); await transfer(st, 'volunteer@thefest.in', confirm=False)
        check('transfer needs confirmation', 'Tick the box' in await err(st))
        await transfer(st, 'volunteer@thefest.in')
        await st.wait_for_url('**/tickets?sent=*')
        check('transfer succeeds', 'Ticket sent to Kiran' in await st.text_content('.alert.ok'))
        row = q(f"select status, void_reason, transferred_to from tickets where id='{tid}'").split('|')
        check('old ticket voided', row[0] == 'void' and 'Transferred' in row[1], row)
        new = row[2]
        nrow = q(f"select u.email, t.status, t.code from tickets t join users u on u.id=t.user_id where t.id='{new}'").split('|')
        check('new ticket issued to recipient with a new code', nrow[0] == 'volunteer@thefest.in' and nrow[1] == 'valid' and nrow[2] != old_code, nrow)
        await st.goto(f'{B}/tickets/{tid}')
        check('old ticket page shows it is no longer valid', 'no longer valid' in await st.text_content('main'))
        check('old ticket shows no QR', await st.locator('[aria-label="Ticket QR code"]').count() == 0)
        check('recipient emailed', q("select count(*) from email_outbox where to_email='volunteer@thefest.in' and subject like '%sent you a ticket%'") == '1')
        vo = await login(b, 'volunteer@thefest.in')
        await vo.goto(f'{B}/tickets/{new}')
        check('recipient sees new ticket with QR', await vo.locator('[aria-label="Ticket QR code"]').count() == 1)
        check('recipient can pass it on', await vo.locator('text=Transfer this ticket to a friend').count() == 1)

        # ── Co-organizers ──
        own = await login(b, 'organizer@thefest.in')
        await own.goto(f'{B}/organizer/{hv}/settings')
        await own.click('text=Turn off')
        await own.wait_for_selector('text=Off — tickets stay with the buyer')
        await vo.goto(f'{B}/tickets/{new}')
        check('organizer can switch transfers off', await vo.locator('text=Transfer this ticket to a friend').count() == 0)
        await own.click('text=Turn on'); await own.wait_for_selector('text=On — students can pass')

        co = await login(b, 'organizer2@thefest.in')
        r = await co.goto(f'{B}/organizer/{hv}')
        check('non-member organizer cannot open the fest', r.status == 404)
        await own.fill('#team input[name=email]', 'student@thefest.in'); await own.click('text=Add co-organizer')
        await own.wait_for_selector('#team .alert.ok')
        check('adding a student account warns', 'student account' in await own.text_content('#team .alert.ok'))
        await own.fill('#team input[name=email]', 'organizer2@thefest.in'); await own.click('text=Add co-organizer')
        await own.wait_for_function("document.querySelector('#team .alert.ok')?.textContent.includes('can now manage')")
        check('owner adds co-organizer', True)
        check('co-organizer emailed', q("select count(*) from email_outbox where to_email='organizer2@thefest.in' and subject like '%co-organizer%'") == '1')

        await co.goto(f'{B}/organizer')
        check('co-organizer sees the fest in their list', await co.locator('text=HackVerse').count() > 0)
        r = await co.goto(f'{B}/organizer/{hv}/settings')
        check('co-organizer can open settings', r.status == 200)
        check('co-organizer cannot cancel the fest', await co.locator('text=Cancel this fest').count() == 0)
        check('co-organizer cannot add members', await co.locator('text=Add co-organizer').count() == 0)
        await co.goto(f'{B}/organizer/{hv}/payments')
        check('co-organizer cannot change UPI payout ID', await co.locator('input[name=upi_vpa]').count() == 0 and await co.locator('text=Only the fest’s owner').count() == 1)
        await co.goto(f'{B}/organizer/{hv}/sales')
        check('co-organizer cannot refund', await co.locator('text=Cancel / refund').count() == 0)
        await own.goto(f'{B}/organizer/{hv}/sales')
        check('owner can refund', await own.locator('text=Cancel / refund').count() > 0)
        await co.goto(f'{B}/organizer/{hv}/announcements')
        await co.fill('input[name=title]', 'Co-organizer test update: doors open at 9')
        await co.click('button[type=submit]:has-text("Post")')
        await co.wait_for_selector('text=Co-organizer test update')
        check('co-organizer can post announcements', True)
        r = await co.context.request.get(f'{B}/organizer/{hv}/export')
        check('co-organizer can export attendee CSV', r.status == 200 and 'TF-' in await r.text())

        await own.goto(f'{B}/organizer/{hv}/settings')
        await own.locator('#team .member', has_text='organizer2@').locator('text=Remove').click()
        await own.wait_for_function("!document.querySelector('#team').textContent.includes('organizer2@')")
        r = await co.goto(f'{B}/organizer/{hv}')
        check('removed co-organizer loses access', r.status == 404)
        await b.close()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} team checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

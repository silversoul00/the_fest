# Ticket transfer + co-organizers.
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def q_until(sql, want, secs=8):  # emails are sent in the background after the response: wait up to `secs` for `want`
    end = time.time() + secs
    while True:
        v = q(sql)
        if v == want or time.time() > end: return v
        time.sleep(0.25)

async def login(b, email):
    pg = await (await b.new_context()).new_page()
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def err(pg, expect):
    # Wait for this submit's message — the previous error stays on screen until it's replaced
    try: await pg.wait_for_selector(f'.alert.error:has-text("{expect}")', timeout=10000)
    except Exception: pass
    return await pg.text_content('.alert.error')

async def add_role(pg, email, role, expect):
    # Team tab (v2.7): co-organizers are added there with the role picker
    f = pg.locator('#add-role form')
    await f.locator('input[name=email]').fill(email); await f.locator('select[name=role]').select_option(role)
    await f.locator('button[type=submit]').click()
    await pg.wait_for_selector(f'#add-role .alert:has-text("{expect}")', timeout=10000)
    return await pg.text_content('#add-role .alert')

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
        check('transfer to unknown email refused', 'sign up first' in await err(st, 'sign up first'))
        await transfer(st, 'organizer@thefest.in')
        check('transfer to organizer account refused', 'student accounts' in await err(st, 'student accounts'))
        await st.uncheck('input[name=confirm]'); await transfer(st, 'volunteer@thefest.in', confirm=False)
        check('transfer needs confirmation', 'Tick the box' in await err(st, 'Tick the box'))
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
        check('recipient emailed', q_until("select count(*) from email_outbox where to_email='volunteer@thefest.in' and subject like '%sent you a ticket%'", '1') == '1')
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
        await own.goto(f'{B}/organizer/{hv}/team')
        # Harshith (Oct 24): role holders use normal (student) accounts — a student can be a co-organizer
        t = await add_role(own, 'attendee5@seed.thefest.in', 'co_organizer', 'can start now')
        check('a student account can be added as co-organizer', 'Co-organizer' in t, t)
        q(f"delete from fest_roles where fest_id='{hv}' and email='attendee5@seed.thefest.in'")
        t = await add_role(own, 'organizer2@thefest.in', 'co_organizer', 'can start now')
        check('owner adds co-organizer', 'Co-organizer' in t, t)
        check('co-organizer emailed', q_until("select count(*) from email_outbox where to_email='organizer2@thefest.in' and subject ilike '%co-organizer%'", '1') == '1')

        await co.goto(f'{B}/organizer')
        check('co-organizer sees the fest in their list', await co.locator('text=HackVerse').count() > 0)
        r = await co.goto(f'{B}/organizer/{hv}/settings')
        check('co-organizer can open settings', r.status == 200)
        check('co-organizer cannot cancel the fest', await co.locator('text=Cancel this fest').count() == 0)
        await co.goto(f'{B}/organizer/{hv}/team')
        check('co-organizer cannot add co-organizers (not offered)', await co.locator('select[name=role] option[value=co_organizer]').count() == 0)
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

        # Email-based access needs a confirmed inbox: a stranger who signs up with an invited address gets nothing
        await own.goto(f'{B}/organizer/{hv}/team')
        await add_role(own, 'newcomer@college.edu', 'co_organizer', 'emailed newcomer@')
        nc = await (await b.new_context()).new_page()
        await nc.goto(B + '/signup?role=organizer')
        await nc.fill('input[name=name]', 'New Comer'); await nc.fill('input[name=email]', 'newcomer@college.edu')
        await nc.fill('input[name=password]', 'password123')
        await nc.click('button[type=submit]'); await nc.wait_for_url('**/organizer/new')
        check('unverified account sees the confirm-email notice', await nc.locator('.verify-notice').count() == 1)
        r = await nc.goto(f'{B}/organizer/{hv}')
        check('unverified invitee cannot open the fest', r.status == 404)
        body = q("select body_text from email_outbox where to_email='newcomer@college.edu' and subject like 'Confirm%' order by id desc limit 1")
        link = next(l for l in body.splitlines() if 'verify-email?token=' in l).strip()
        await nc.goto(B + link[link.index('/verify-email'):])
        check('confirm link works', 'confirmed' in (await nc.text_content('h1')).lower())
        r = await nc.goto(f'{B}/organizer/{hv}')
        check('verified invitee can open the fest', r.status == 200)
        await nc.goto(B + link[link.index('/verify-email'):])
        check('confirm link is single-use', 'expired' in (await nc.text_content('h1')).lower())

        # Admin pages refuse non-admins even on client-side navigation requests
        res = await co.context.request.get(f'{B}/admin/orders', headers={'RSC': '1', 'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22admin%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%5D'})
        txt = await res.text()
        adm = await login(b, 'admin@thefest.in')
        ctl = await (await adm.context.request.get(f'{B}/admin/orders', headers={'RSC': '1', 'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22admin%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%5D'})).text()
        check('control: same RSC request works for an admin', 'Needs a look' in ctl)
        check('admin page data not served to non-admin (RSC request)', 'student@thefest.in' not in txt and 'Needs a look' not in txt, res.status)

        await own.goto(f'{B}/organizer/{hv}/team')
        await own.locator('#team-list .member', has_text='organizer2@').locator('button:has-text("Remove")').click()
        await own.wait_for_function("!document.querySelector('#team-list').textContent.includes('organizer2@')")
        r = await co.goto(f'{B}/organizer/{hv}')
        check('removed co-organizer loses access', r.status == 404)
        await b.close()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} team checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

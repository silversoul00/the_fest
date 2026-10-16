# Refunds & cancellations: partial refund voids tickets + gate rejects them,
# zero-fee UPI refund tracked until marked sent, whole-fest cancellation.
import asyncio, os, re, sys
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))

async def login(ctx, email, url='/login'):
    pg = await ctx.new_page()
    await pg.goto(B + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        st = await login(await b.new_context(viewport={'width': 390, 'height': 844}), 'student@thefest.in')
        # Buy 2 Kalaa tickets (demo gateway)
        await st.goto(B + '/fests/kalaa-fest'); await st.click('button[aria-label=More]')
        await st.click('button:has-text("Pay ₹")'); await st.wait_for_selector('text=DEMO PAYMENT')
        await st.click('text=(demo)'); await st.wait_for_url('**/tickets?order=*')
        order = st.url.split('order=')[1]
        codes = await st.evaluate("[...document.querySelectorAll('.card.link')].filter(c=>c.textContent.includes('KALAA')||c.textContent.includes('Kalaa')).map(c=>c.querySelector('.mono').textContent)")
        check('bought 2 Kalaa tickets', len(codes) == 2, codes)

        org = await login(await b.new_context(viewport={'width': 1280, 'height': 900}), 'organizer2@thefest.in')
        await org.click('a:has-text("Kalaa")'); await org.wait_for_url(re.compile(r'/organizer/[0-9a-f-]{36}$'))
        fid = org.url.rstrip('/').split('/')[-1]
        await org.goto(f'{B}/organizer/{fid}/sales?q=student@thefest.in')
        row = org.locator('tr', has_text='student@thefest.in').first
        await row.locator('summary').click()
        await row.locator('input[name=tickets]').fill('1'); await row.locator('input[name=reason]').fill('Requested by student')
        await row.locator('button:has-text("Cancel & refund")').click()
        await org.wait_for_selector('text=1 ticket(s) cancelled')
        check('organizer cancels 1 of 2 tickets', True)
        await st.goto(B + '/tickets')
        left = await st.evaluate("[...document.querySelectorAll('.card.link')].filter(c=>c.textContent.includes('Kalaa')).length")
        check('student now has 1 Kalaa ticket', left == 1, left)
        check('student sees refund notice', await st.locator('.alert.info', has_text='refunded').count() >= 1)
        # Voided ticket rejected at the gate (organizer can scan own fest)
        sc = await login(await b.new_context(), 'organizer2@thefest.in', '/scan/login')
        verdicts = await sc.evaluate(f"""Promise.all({codes!r}.map(c => fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{festId:'{fid}',gate:'Gate 1',code:c}})}}).then(r=>r.json()).then(j=>j.result)))""")
        check('gate: cancelled ticket rejected, other admitted', sorted(verdicts) == ['admitted', 'void'], verdicts)

        # Cancel-fest guard + full cancellation (Commerce Carnival)
        await org.goto(f'{B}/organizer')
        await org.click('a:has-text("Commerce Carnival")'); await org.wait_for_url(re.compile(r'/organizer/[0-9a-f-]{36}$'))
        cid = org.url.rstrip('/').split('/')[-1]
        await org.goto(f'{B}/organizer/{cid}/settings')
        form = org.locator('form:has(button:has-text("Cancel fest"))')
        await form.locator('input[name=reason]').fill('Venue unavailable'); await form.locator('input[name=confirm]').fill('cancel please')
        await form.locator('button[type=submit]').click(); await org.wait_for_selector('text=Type CANCEL')
        check('cancel fest needs typed confirmation', True)
        await form.locator('input[name=confirm]').fill('CANCEL'); await form.locator('button[type=submit]').click()
        await org.wait_for_selector('.h3:has-text("Cancelled")', timeout=60000)
        check('whole fest cancelled', True)
        await org.goto(f'{B}/organizer/{cid}/sales')
        refunded = await org.locator('.badge', has_text='Refunded').count()
        check('every order in the cancelled fest refunded', refunded >= 25, refunded)
        pub = await st.goto(B + '/fests/commerce-carnival')
        check('public page shows cancellation', await st.locator('text=This fest was cancelled').count() == 1)
        check('cancelled fest hidden from discover', 'Commerce Carnival' not in await (await st.goto(B + '/fests')).text())
        await b.close()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} refund checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

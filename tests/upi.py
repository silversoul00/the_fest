# Zero-fee bank UPI flow: buy → UTR → match by pasted alert, by statement (amount only),
# amount mismatch → flagged → manual confirm, UTR reuse blocked, inbound-email endpoint.
# Run via tests/run-e2e.sh (needs a running server on freshly seeded data).
import asyncio, os, re, sys, json
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))

async def login(ctx, email):
    pg = await ctx.new_page()
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def buy_upi(pg, utr=None):
    await pg.goto(B + '/fests/neon-utsav')
    await pg.click('text=UPI to the fest')
    await pg.click('button:has-text("by UPI")')
    await pg.wait_for_selector('text=Pay exactly')
    amount = await pg.text_content('.alert.info strong')
    order = None
    if utr:
        await pg.fill('input[placeholder="412345678901"]', utr)
        await pg.click('button:has-text("I’ve paid")')
        await pg.wait_for_url('**/tickets?order=*')
        order = pg.url.split('order=')[1]
    return amount, order

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        oc = await b.new_context(viewport={'width': 1280, 'height': 900}); org = await login(oc, 'organizer@thefest.in')
        await org.click('a:has-text("Neon Utsav")'); await org.wait_for_url(re.compile(r'/organizer/[0-9a-f-]{36}$'))
        fid = org.url.rstrip('/').split('/')[-1]
        # Enable zero-fee UPI
        await org.goto(f'{B}/organizer/{fid}/payments')
        await org.fill('input[name=upi_vpa]', 'bad id')
        await org.check('input[name=upi_enabled]'); await org.click('button:has-text("Save")')
        await org.wait_for_selector('.alert.error'); check('invalid UPI ID rejected', True)
        await org.fill('input[name=upi_vpa]', 'neonutsav@icici'); await org.click('button:has-text("Save")')
        await org.wait_for_selector('text=Zero-fee UPI is on'); check('UPI enabled', True)

        sc = await b.new_context(viewport={'width': 390, 'height': 844}); st = await login(sc, 'student@thefest.in')
        # 1) Buy, enter UTR, organizer pastes alert → confirmed
        amt1, o1 = await buy_upi(st, '512345678901')
        check('UPI order waits for confirmation', await st.locator('text=confirming with the fest').count() >= 1, amt1)
        rupees = amt1.replace('₹', '').replace(',', '')
        await org.goto(f'{B}/organizer/{fid}/payments')
        await org.fill('textarea[name=alerts]', f'Dear Customer, Rs.{rupees} has been credited to your A/c XX1234 by VPA arjun@okaxis. UPI Ref No 512345678901.')
        await org.click('button:has-text("Match payments")'); await org.wait_for_selector('text=1 confirmed')
        check('pasted alert confirms order', True)
        await st.goto(f'{B}/tickets?order={o1}')
        check('student gets ticket after match', await st.locator('text=You\'re in!').count() == 1)
        # 2) Buy WITHOUT entering UTR; statement has only amount + real UTR → match by unique amount
        amt2, _ = await buy_upi(st)
        r2 = amt2.replace('₹', '').replace(',', '')
        csv = f'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Balance\n17/10/26,UPI-ARJUN-arjun@okaxis-612345678901-PAY,0000612345678901,,{r2},9999\n'
        path = '/tmp/thefest-stmt.csv'; open(path, 'w').write(csv)
        await org.goto(f'{B}/organizer/{fid}/payments')
        await org.set_input_files('input[name=statement]', path)
        await org.click('button:has-text("Upload")'); await org.wait_for_selector('text=1 confirmed')
        check('statement matches by unique amount (no UTR typed)', True)
        # 3) UTR typed but amount wrong → flagged → organizer confirms manually
        amt3, o3 = await buy_upi(st, '712345678901')
        await org.goto(f'{B}/organizer/{fid}/payments')
        await org.fill('textarea[name=alerts]', 'Rs.1.00 credited to your A/c XX1234. UPI Ref No 712345678901.')
        await org.click('button:has-text("Match payments")'); await org.wait_for_selector('text=1 need a look')
        check('wrong amount is flagged, not confirmed', True)
        await org.goto(f'{B}/organizer/{fid}/payments')
        card = org.locator('.card.tight', has_text='712345678901')
        await card.locator('button:has-text("Confirm")').click(); await org.wait_for_load_state('networkidle')
        st_status = await st.evaluate(f"fetch('/orders/{o3}').then(r=>r.url)")
        check('manual confirm issues ticket', '/tickets' in st_status, st_status)
        # 4) Re-using a UTR is blocked
        await st.goto(B + '/fests/neon-utsav'); await st.click('text=UPI to the fest'); await st.click('button:has-text("by UPI")')
        await st.wait_for_selector('text=Pay exactly')
        await st.fill('input[placeholder="412345678901"]', '512345678901'); await st.click('button:has-text("I’ve paid")')
        await st.wait_for_selector('.alert.error')
        check('UTR reuse blocked', 'already been used' in await st.text_content('.alert.error'))
        # 5) Same alert pasted twice → ignored as duplicate
        await org.goto(f'{B}/organizer/{fid}/payments')
        await org.fill('textarea[name=alerts]', f'Rs.{rupees} credited to your A/c. UPI Ref No 512345678901.')
        await org.click('button:has-text("Match payments")'); await org.wait_for_selector('text=already seen')
        check('duplicate alert ignored', True)
        # 6) Inbound email endpoint: student enters UTR first, then email arrives → confirmed
        amt6, o6 = await buy_upi(st, '812345678901')
        await org.goto(f'{B}/organizer/{fid}/payments'); await org.click('button:has-text("Create link")'); await org.wait_for_load_state('networkidle')
        link = await org.locator('.mono.small.accent').text_content()
        token = link.strip().split('/inbound/')[1]
        bad = await st.evaluate(f"fetch('/api/upi/inbound/notarealtoken123456',{{method:'POST',body:'x'}}).then(r=>r.status)")
        check('inbound email: bad token → 404', bad == 404, bad)
        r6 = amt6.replace('₹', '').replace(',', '')
        res = await st.evaluate(f"""fetch('/api/upi/inbound/{token}',{{method:'POST',headers:{{'Content-Type':'application/json'}},
            body:JSON.stringify({{Subject:'Credit alert',TextBody:'Dear Customer, INR {r6} credited to your account. UPI Ref No 812345678901'}})}}).then(r=>r.json())""")
        check('inbound email confirms order', res.get('matched') == 1, json.dumps(res))
        # 7) Gateway option still shows payment charges; UPI option shows none
        await st.goto(B + '/fests/neon-utsav'); await st.click('text=Card / UPI checkout')
        check('card checkout shows payment charges line', await st.locator('.row.between span', has_text='Payment charges').count() == 1)
        await st.click('text=UPI to the fest')
        check('UPI option has no payment charges', await st.locator('.row.between span', has_text='Payment charges').count() == 0)
        await b.close()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} UPI checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

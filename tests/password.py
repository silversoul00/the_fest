# Password reset: no account enumeration, link works once, old password stops working,
# other sessions are signed out, expired/invalid links rejected.
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()

async def login(pg, email, pw):
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', pw)
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        other = await (await b.new_context()).new_page(); await login(other, 'student@thefest.in', 'password123')
        check('signed in on another device', other.url.endswith('/fests'))
        pg = await (await b.new_context()).new_page()
        await pg.goto(B + '/login'); await pg.click('text=Forgot password?'); await pg.wait_for_url('**/forgot-password')
        for email in ('nobody-here@example.com', 'student@thefest.in'):
            await pg.fill('input[name=email]', email); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.alert.ok')
        same = await pg.locator('.alert.ok').text_content()
        check('same answer for unknown and known emails', 'If an account exists' in same)
        check('no email sent to unknown address', q("select count(*) from email_outbox where to_email='nobody-here@example.com'") == '0')
        body = q("select body_text from email_outbox where to_email='student@thefest.in' and subject like 'Reset%' order by id desc limit 1")
        link = next(l for l in body.splitlines() if 'reset-password?token=' in l).strip()
        check('reset email has a link', '/reset-password?token=' in link)
        path = link[link.index('/reset-password'):]
        await pg.goto(B + path)
        await pg.fill('input[name=password]', 'newpass123'); await pg.fill('input[name=confirm]', 'different1')
        await pg.click('button[type=submit]'); await pg.wait_for_selector('.alert.error')
        check('mismatched passwords rejected', 'match' in await pg.text_content('.alert.error'))
        await pg.fill('input[name=password]', 'newpass123'); await pg.fill('input[name=confirm]', 'newpass123')
        await pg.click('button[type=submit]'); await pg.wait_for_url('**/fests')
        check('reset logs straight in', True)
        await other.goto(B + '/tickets')
        check('other device signed out', '/login' in other.url, other.url)
        fresh = await (await b.new_context()).new_page()
        await login(fresh, 'student@thefest.in', 'password123')
        check('old password no longer works', await fresh.locator('.alert.error').count() == 1)
        await login(fresh, 'student@thefest.in', 'newpass123')
        check('new password works', fresh.url.endswith('/fests'))
        await fresh.goto(B + path)
        # Bug hunt L5 (2026-10-23): a used link says so straight away — no password form to type into
        await fresh.wait_for_selector('.alert.error')
        check('reset link works only once', 'expired or was already used' in await fresh.text_content('.alert.error')
              and await fresh.locator('input[name=password]').count() == 0)
        # put the demo password back for other tests
        await fresh.goto(B + '/forgot-password'); await fresh.fill('input[name=email]', 'student@thefest.in'); await fresh.click('button[type=submit]'); await fresh.wait_for_selector('.alert.ok')
        body = q("select body_text from email_outbox where to_email='student@thefest.in' and subject like 'Reset%' order by id desc limit 1")
        link = next(l for l in body.splitlines() if 'reset-password?token=' in l).strip()
        await fresh.goto(B + link[link.index('/reset-password'):]); await fresh.fill('input[name=password]', 'password123'); await fresh.fill('input[name=confirm]', 'password123')
        await fresh.click('button[type=submit]'); await fresh.wait_for_url('**/fests')
        await b.close()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} password checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

# Concurrency checks: 8 simultaneous scans of one ticket must admit exactly once;
# 6 buyers racing for the last seat must produce exactly one sale.
# Run via tests/run-e2e.sh (it seeds data and passes the ids in env vars).
import asyncio, os, sys
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
FID, CODE, TT = os.environ['RACE_FEST'], os.environ['RACE_CODE'], os.environ['RACE_TT']

async def login(b, email, url='/login'):
    pg = await (await b.new_context()).new_page()
    await pg.goto(B + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        v = await login(b, 'volunteer@thefest.in', '/scan/login')
        res = await v.evaluate(f"""Promise.all(Array.from({{length:8}},()=>fetch('/api/scan',{{method:'POST',headers:{{'Content-Type':'application/json'}},
            body:JSON.stringify({{festId:'{FID}',gate:'Gate 1',code:'{CODE}'}})}}).then(r=>r.json()).then(j=>j.result)))""")
        scans_ok = res.count('admitted') == 1
        print(('PASS' if scans_ok else 'FAIL'), '8 parallel scans ->', res.count('admitted'), 'admitted')
        buyers = [await login(b, f'attendee{100 + i}@seed.thefest.in') for i in range(6)]
        js = f"fetch('/api/checkout',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{ticketTypeId:'{TT}',qty:1}})}}).then(r=>r.status)"
        outs = await asyncio.gather(*[pg.evaluate(js) for pg in buyers])
        seat_ok = outs.count(200) == 1
        print(('PASS' if seat_ok else 'FAIL'), '6 buyers for last seat ->', outs.count(200), 'sale(s)')
        await b.close()
        sys.exit(0 if scans_ok and seat_ok else 1)

asyncio.run(main())

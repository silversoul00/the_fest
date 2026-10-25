# Fix round 2 for the Oct 23 bug-hunt fixes (docs/team/reviews/2026-10-23-bugfix-review-1.md and -test-1.md):
#   F1  a rename clears THE FEST's approval whatever the status: End → rename → Reopen goes to review (Unpublish is in
#       bugfix_oct23_retest.py); renaming twice keeps the original name in the note
#   F2  the "Renamed from…" note survives Withdraw → Submit, the admin sees it, approving clears it
#   F3  the first ticket sells while the organizer is editing: the server's reply brings up the "I understand" tick
#   L8  a Sales page number past the end shows the last real page
#   L9  no hydration error (#418) on Sales / Analytics on a slow connection (that is what triggers it)
#   N1  ?next= with broken percent-encoding or "/..//host" never crashes and never leaves the site
# Main server on :3000 with the seeded database. Makes its own fests.
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright

B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
DESKTOP = dict(viewport={'width': 1280, 'height': 900})
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()

async def login(b, email, opts=MOBILE):
    ctx = await b.new_context(**opts); pg = await ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200])); pg.errs = errs
    await pg.goto(B + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg
async def alert(pg, want, timeout=10000):
    try: await pg.locator('.alert', has_text=want).first.wait_for(timeout=timeout); return True
    except Exception: return False
async def body(pg): return await pg.locator('body').inner_text()

ORG = q("select id from users where email='organizer@thefest.in'")
STU = q("select id from users where email='student@thefest.in'")
n_code = [0]
def mk_fest(slug, name, status='live', tickets=1):
    fid = q(f"""insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, status, approved_at)
                values ('{slug}', '{ORG}', '{name}', 'Fix College', 'Bengaluru', 'Hall A', 'cultural', (now() at time zone 'Asia/Kolkata')::date + 20, (now() at time zone 'Asia/Kolkata')::date + 21,
                        '{status}', now()) returning id""").split('\n')[0]
    tt = q(f"insert into ticket_types (fest_id, name, price_paise, quota, sold) values ('{fid}', 'Day Pass', 10000, 100, {tickets}) returning id").split('\n')[0]
    for _ in range(tickets): add_ticket(fid, tt)
    return fid, tt
def add_ticket(fid, tt):
    n_code[0] += 1
    oid = q(f"insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, status, provider, paid_at) values ('{STU}', '{fid}', '{tt}', 1, 10000, 'paid', 'demo', now()) returning id").split('\n')[0]
    q(f"insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name) select 'TF-FIX2-{n_code[0]:04d}', '{oid}', '{STU}', '{fid}', '{tt}', name from users where id='{STU}'")
def row(fid): return q(f"select status || '|' || (approved_at is null)::text || '|' || coalesce(review_note, '') from fests where id='{fid}'")

async def status_btn(pg, fid, to):
    await pg.goto(f'{B}/organizer/{fid}/settings')
    await pg.click(f'form:has(input[name=status][value={to}]) button'); await pg.wait_for_load_state('networkidle')

async def rename(pg, fid, name):
    await pg.goto(f'{B}/organizer/{fid}/settings')
    await pg.fill('form:has(input[name=venue]) input[name=name]', name)
    if await pg.locator('input[name=confirm_notice]').count(): await pg.check('input[name=confirm_notice]')
    await pg.click('form:has(input[name=venue]) button[type=submit]')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        org = await login(b, 'organizer@thefest.in')
        adm = await login(b, 'admin@thefest.in', DESKTOP)

        # ── F1: End fest → rename → Reopen goes to review ──
        f1, _ = mk_fest('fix2-ended-fest', 'Fix Two Ended Fest')
        await status_btn(org, f1, 'ended')
        await rename(org, f1, 'Fix Two Other Name')
        ok = await alert(org, 'when you publish')
        r1 = row(f1)
        await org.goto(f'{B}/organizer/{f1}/settings')
        shown = await org.locator('[data-testid=rename-note]').count()
        await status_btn(org, f1, 'live')
        r2 = row(f1)
        check('F1 ended fest with tickets: rename clears approval and keeps the note (status stays ended), says so on Settings',
              ok and r1.startswith('ended|true|Renamed from “Fix Two Ended Fest” to “Fix Two Other Name”') and shown == 1, (r1, shown))
        check('F1 … then Reopen goes to admin review (not live), note kept', r2.startswith('review|true|Renamed from “Fix Two Ended Fest”'), r2)

        # ── Decision 1 (Harshith, Oct 24): every rename of an approved fest is re-checked, even with no tickets sold ──
        f0, _ = mk_fest('fix2-zero-fest', 'Fix Two Zero Fest', tickets=0)
        await status_btn(org, f0, 'draft')
        await org.goto(f'{B}/organizer/{f0}/settings')
        await org.fill('form:has(input[name=venue]) input[name=name]', 'Fix Two Zero Renamed')
        nt = await org.locator('[data-testid=change-notice]').inner_text() if await org.locator('[data-testid=change-notice]').count() else ''
        await org.click('form:has(input[name=venue]) button[type=submit]')
        ok = await alert(org, 'when you publish')
        await status_btn(org, f0, 'live')
        r = row(f0)
        check('Decision 1 no tickets sold: draft → rename (heads-up, no tick needed) → Publish goes to review with a note; nobody emailed',
              'admin review first' in nt and ok and r.startswith('review|true|Renamed from “Fix Two Zero Fest”')
              and q("select count(*) from email_outbox where subject like 'Fix Two Zero%'") == '0', (nt, r))

        # ── F2: rename (→ review) → Withdraw → Submit keeps the note; renaming twice keeps the original name ──
        f2, _ = mk_fest('fix2-note-fest', 'Fix Two Note Fest')
        await rename(org, f2, 'Fix Two Renamed Once')
        await alert(org, 'quick check')
        # Harshith (Oct 24): while a renamed fest is re-checked its public page stays up, sales paused, tickets keep working
        for opts, label in ((MOBILE, '390'), (DESKTOP, '1280')):
            anon = await (await b.new_context(**opts)).new_page()
            resp = await anon.goto(f'{B}/fests/fix2-note-fest')
            txt = await body(anon)
            await anon.screenshot(path=os.environ.get('E2E_DIR', '/tmp') + f'/fix2_under_review_{label}.png', full_page=True)
            sideways = await anon.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1')
            check(f'Decision 2 renamed fest in review: public page stays up for anyone with "Under review — ticket sales paused", schedule shown, no buying ({label}px)',
                  resp.status == 200 and 'Under review — ticket sales paused' in txt and 'Fix Two Renamed Once' in txt and 'Schedule' in txt
                  and await anon.locator('#tickets button').count() == 0 and not sideways, (resp.status, txt[:200]))
            await anon.context.close()
        tt2 = q(f"select id from ticket_types where fest_id='{f2}'")
        st = await login(b, 'student@thefest.in')
        buy = await st.evaluate("fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticketTypeId:'%s',qty:1})}).then(async r=>[r.status, await r.text()])" % tt2)
        await st.goto(B + '/tickets')
        mine = await body(st)
        check('Decision 2 … buying is refused by the server; the holder still sees the ticket on /tickets',
              buy[0] >= 400 and 'not on sale' in buy[1] and 'Fix Two Renamed Once' in mine, (buy, mine[:200]))
        fresh = q(f"""insert into fests (slug, organizer_id, name, college, city, category, starts_on, ends_on, status)
                      values ('fix2-new-review', '{ORG}', 'Fix Two Brand New', 'Fix College', 'Bengaluru', 'cultural', (now() at time zone 'Asia/Kolkata')::date + 20, (now() at time zone 'Asia/Kolkata')::date + 21, 'review') returning id""")
        anon = await (await b.new_context(**MOBILE)).new_page()
        r404 = await anon.goto(f'{B}/fests/fix2-new-review')
        rdraft = await anon.goto(f'{B}/fests/fix2-ended-fest')  # renamed but status review → visible; check a plain draft below
        q("update fests set status='draft', review_note=null where slug='fix2-ended-fest'")
        rdraft = await anon.goto(f'{B}/fests/fix2-ended-fest')
        check('Decision 2 … a never-approved fest waiting for its first review, and drafts, stay hidden (404)', r404.status == 404 and rdraft.status == 404 and fresh, (r404.status, rdraft.status))
        await anon.context.close()
        await status_btn(org, f2, 'draft')
        await org.goto(f'{B}/organizer/{f2}')
        ov = await body(org)
        check('F2 renamed then withdrawn: overview shows the rename note, not "THE FEST sent it back"',
              'Renamed from' in ov and 'sent it back' not in ov, ov[:300])
        await rename(org, f2, 'Fix Two Renamed Twice')
        await alert(org, 'quick check')
        await org.goto(f'{B}/organizer/{f2}')
        await org.click('button:has-text("Submit for approval")'); await org.wait_for_load_state('networkidle')
        r = row(f2)
        check('F2 withdraw → rename again → Submit: in review, note still names the ORIGINAL and the newest name',
              r.startswith('review|true|Renamed from “Fix Two Note Fest” to “Fix Two Renamed Twice”'), r)
        await adm.goto(B + '/admin')
        check('F2 admin queue shows the rename note', 'Renamed from “Fix Two Note Fest” to “Fix Two Renamed Twice”' in await body(adm))
        card = adm.locator('.card', has_text='Fix Two Renamed Twice').first
        await card.locator('button:has-text("Approve")').click()
        await adm.locator('.card', has_text='Fix Two Renamed Twice').wait_for(state='detached', timeout=10000)
        r = row(f2)
        check('F2 admin approves → live, approval set, note cleared', r == 'live|false|', r)

        # ── F3: first ticket sells while the organizer is editing ──
        f3, tt3 = mk_fest('fix2-race-fest', 'Fix Two Race Fest', tickets=0)
        await org.goto(f'{B}/organizer/{f3}/settings')
        await org.fill('input[name=venue]', 'Hall B')
        before = await org.locator('input[name=confirm_notice]').count()
        add_ticket(f3, tt3)  # someone buys now, in another browser
        await org.click('form:has(input[name=venue]) button[type=submit]')
        asked = await alert(org, 'Tick “I understand”')
        box = await org.locator('[data-testid=change-notice] input[name=confirm_notice]').count()
        nt = await org.locator('[data-testid=change-notice]').inner_text() if await org.locator('[data-testid=change-notice]').count() else ''
        typed = await org.input_value('input[name=venue]')
        check('F3 ticket sold mid-edit: server asks, and the form now shows the warning with the "I understand" tick (typed venue kept)',
              before == 0 and asked and box == 1 and 'emails 1 ticket holder' in nt and typed == 'Hall B', (before, asked, box, nt, typed))
        if box: await org.check('input[name=confirm_notice]')
        await org.click('form:has(input[name=venue]) button[type=submit]')
        ok = await alert(org, 'being emailed')
        check('F3 … tick and save again → saved, the holder is emailed', ok and q(f"select venue from fests where id='{f3}'") == 'Hall B')
        await org.screenshot(path=os.environ.get('E2E_DIR', '/tmp') + '/fix2_f3_tick_390.png', full_page=True)

        # ── L8: past the end → last real page ──
        gr = q("select id from fests where slug='goal-rush'")
        total = int(q(f"select count(*) from orders where fest_id='{gr}' and status in ('paid','refunded')"))
        last = max(1, -(-total // 50))
        await org.goto(f'{B}/organizer/{gr}/sales?page=99999', wait_until='networkidle')
        nav = ' '.join(await org.locator('nav[aria-label=Pages]').all_inner_texts())
        rows = await org.locator('table').last.locator('tbody tr').count()
        check('L8 Sales ?page=99999 → last page: "page N of N" and its rows', f'page {last} of {last}' in nav and rows == total - (last - 1) * 50, (nav, rows, total))

        # ── L9: slow connection (the trigger) — Sales and Analytics hydrate without #418 ──
        slow = await login(b, 'organizer@thefest.in')
        cdp = await slow.context.new_cdp_session(slow)
        await cdp.send('Network.enable')
        await cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 40, 'downloadThroughput': 200 * 1024, 'uploadThroughput': 100 * 1024})
        slow.errs.clear()
        for i in range(40):
            await slow.goto(f'{B}/organizer/{gr}/sales' + ('?page=2' if i % 2 else ''), wait_until='networkidle')
        sales_errs = list(slow.errs); slow.errs.clear()
        for i in range(30):
            await slow.goto(f'{B}/organizer/{gr}/analytics', wait_until='networkidle')
        check('L9 slow connection: 40 Sales loads, no hydration error (#418)', not sales_errs, (len(sales_errs), sales_errs[:1]))
        check('L9 slow connection: 30 Analytics loads, no hydration error (#418)', not slow.errs, (len(slow.errs), slow.errs[:1]))

        # ── N1: broken encoding / dot segments ──
        for n in ['/%ZZ', '/fests/%25E0%25A4', '/..//example.org', '/%2e%2e//example.org', '/a/../..//example.org']:
            r = await org.request.get(f'{B}/login?next={n}', max_redirects=0)
            loc = r.headers.get('location', '')
            check(f'N1 logged-in /login?next={n} → redirect on THE FEST, not 500', r.status in (302, 303, 307, 308) and loc.startswith('/') and not loc.startswith('//'), (r.status, loc))

        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} fix-round-2 checks passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())

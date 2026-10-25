# Fest events fix round 1 (Oct 25 2026) — docs/team/reviews/2026-10-25-fest-events-review-1.md (#1–#6) and
# docs/team/reviews/2026-10-25-fest-events-test-1.md (F1–F9). Runs after tests/events.py on the seeded local database
# and the server on :3000 (run-e2e.sh, DEMO_PAYMENTS=1).
import asyncio, csv, io, os, random, subprocess, time
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + 'events-fix1: ' + name + (f'  [{extra}]' if extra not in ('', None) else ''))
def q(sql): return subprocess.run(DB + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()

NEON = q("select id from fests where slug='neon-utsav'")
COL = 'Demo Institute of Technology'
def mk(em, nm, ticket=True):
    q(f"insert into users (email, password_hash, name, role, college, email_verified_at) select '{em}', password_hash, '{nm}', 'student', '{COL}', now() from users where email='student@thefest.in' on conflict (email) do nothing")
    if ticket and q(f"select count(*) from tickets t join users u on u.id=t.user_id where u.email='{em}' and t.fest_id='{NEON}' and t.status<>'void'") == '0':
        q(f"with o as (insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, provider, method, status, paid_at) "
          f"select u.id, '{NEON}', (select id from ticket_types where fest_id='{NEON}' and kind='entry' order by sort limit 1), 1, 0, 'free', 'free', 'paid', now() from users u where u.email='{em}' returning id, user_id) "
          f"insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name) select 'TF-' || upper(substr(md5(o.id::text), 1, 4)) || '-' || upper(substr(md5(o.id::text), 5, 4)), o.id, o.user_id, '{NEON}', "
          f"(select id from ticket_types where fest_id='{NEON}' and kind='entry' order by sort limit 1), '{nm}' from o")
def mkev(title, tmin=1, tmax=1, price=0, slots=10):
    q(f"with t as (insert into ticket_types (fest_id, name, description, price_paise, quota, sold, sort, kind) values ('{NEON}', 'Event: {title}', '', {price}, {slots}, 0, 1000, 'event') returning id) "
      f"insert into events (fest_id, category, title, starts_at, team_min, team_max, price_paise, slots, reg_deadline, ticket_type_id) "
      f"select '{NEON}', 'other', '{title}', now() + interval '2 days', {tmin}, {tmax}, {price}, {slots}, now() + interval '1 day', t.id from t")
    return q(f"select id from events where title='{title}' and fest_id='{NEON}'")
uid = lambda em: q(f"select id from users where email='{em}'")
taken = lambda ev: int(q(f"select tt.sold from events e join ticket_types tt on tt.id=e.ticket_type_id where e.id='{ev}'"))
def join(reg, ev, em):
    q(f"insert into event_members (reg_id, event_id, email, user_id, status, joined_at) values ('{reg}', '{ev}', '{em}', '{uid(em)}', 'joined', now())")
def backdate(order, mins): q(f"update orders set created_at = now() - interval '{mins} minutes' where id='{order}'")
utr = lambda: str(random.randint(10**11, 10**12 - 1))

async def login(b, email, url='/login', opts=None):
    c = await b.new_context(**(opts or {})); pg = await c.new_page()
    await pg.goto(B + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return c, pg
async def post(c, path, data, timeout=30000):
    r = await c.request.post(B + path, data=data, headers={'Origin': B}, timeout=timeout)
    try: j = await r.json()
    except Exception: j = {}
    return r.status, j
async def alert(pg, sel='.alert.error, .alert.ok, [data-flash]', timeout=8000):
    loc = pg.locator(sel).first
    try: await loc.wait_for(timeout=timeout); return await loc.inner_text()
    except Exception: return ''
async def click_flash(pg, button_sel):
    """Click a button whose form removes itself; the success message must still show (F4)."""
    await pg.locator(button_sel).first.click()
    return await alert(pg, '[data-flash], .alert.error')
async def register(pg, ev, team=None):
    await pg.goto(f'{B}/fests/neon-utsav/events/{ev}')
    if team: await pg.fill('#register input[name=team_name]', team)
    await pg.click('#register button[type=submit]'); await pg.wait_for_url('**/my-events**')

async def main():
    for i in range(1, 11): mk(f'fx{i}@seed.thefest.in', f'Fixa Tester{i}')
    q(f"update fests set upi_enabled = true, upi_vpa = coalesce(upi_vpa, 'neonutsav@icici') where id = '{NEON}'")
    async with async_playwright() as p:
        b = await p.chromium.launch()
        oc, own = await login(b, 'organizer@thefest.in')

        # ── Sup #1: an abandoned payment frees its slot and unfreezes the team (gateway, 15 min) ──
        ev = mkev('Fix One Slot Team', tmin=2, tmax=3, price=30000, slots=1)
        ca, sa = await login(b, 'fx1@seed.thefest.in')
        await register(sa, ev, 'Hold Outs')
        reg = q(f"select id from event_regs where event_id='{ev}'"); join(reg, ev, 'fx2@seed.thefest.in')
        s_, j = await post(ca, '/api/checkout', {'registrationId': reg, 'method': 'gateway'}); o1 = j.get('orderId')
        check('#1 setup: captain starts a card checkout → slot held', s_ == 200 and taken(ev) == 1, (s_, j))
        cb, sb = await login(b, 'fx2@seed.thefest.in'); await sb.goto(f'{B}/my-events')
        m = await click_flash(sb, 'section[data-entry="Fix One Slot Team"] button:has-text("Leave team")')
        check('#1 while the payment is really running, a member can’t leave', 'in progress' in m and q(f"select status from event_members where reg_id='{reg}' and email='fx2@seed.thefest.in'") == 'joined', m)
        await sa.goto(f'{B}/fests/neon-utsav#events')
        check('#1 a held last slot shows Full', 'full' in (await sa.locator('[data-event-card="Fix One Slot Team"]').inner_text()).lower())
        backdate(o1, 20)
        # nothing has released the hold in the database yet — the screens must already ignore it (a fresh load, not a #hash jump)
        await sa.goto(f'{B}/fests/neon-utsav?after=1#events'); card = await sa.locator('[data-event-card="Fix One Slot Team"]').inner_text()
        check('#1 a stale hold never shows "Full" (fest page card)', 'full' not in card.lower() and '1 slot left' in card.lower(), card)
        await sa.goto(f'{B}/my-events'); sec = sa.locator('section[data-entry="Fix One Slot Team"]')
        check('#1 My events: Pay & submit and Withdraw come back after the hold (no "payment in progress")',
              await sec.locator('[data-pay-box]').count() == 1 and await sec.locator('button:has-text("Withdraw entry")').count() == 1
              and 'in progress' not in await sec.inner_text(), await sec.inner_text())
        # (b) a new team registers on the 1-slot event
        cc, sc = await login(b, 'fx3@seed.thefest.in'); await register(sc, ev, 'New Comers')
        check('#1 (b) a new team can register on the 1-slot event; the stale hold is released',
              q(f"select count(*) from event_regs where event_id='{ev}' and captain_id='{uid('fx3@seed.thefest.in')}'") == '1'
              and q(f"select status from orders where id='{o1}'") == 'failed' and taken(ev) == 0, (q(f"select status from orders where id='{o1}'"), taken(ev)))
        # (a) the member can leave (and sees the message after the form goes away)
        await sb.goto(f'{B}/my-events')
        m = await click_flash(sb, 'section[data-entry="Fix One Slot Team"] button:has-text("Leave team")')
        check('#1 (a) a member can leave after the hold; F4 "You left the team." stays visible',
              'You left the team' in m and q(f"select status from event_members where reg_id='{reg}' and email='fx2@seed.thefest.in'") == 'left', m)
        join(reg, ev, 'fx4@seed.thefest.in')
        # (c) the captain can pay again; the old order's late payment goes to the refund list
        s_, j = await post(ca, '/api/checkout', {'registrationId': reg, 'method': 'gateway'}); o2 = j.get('orderId')
        check('#1 (c) the captain can pay again', s_ == 200 and o2 and o2 != o1 and taken(ev) == 1, (s_, j))
        s_, j = await post(ca, '/api/checkout/demo-confirm', {'orderId': o1})
        check('#1 the old order’s late payment → refund list, the entry is not confirmed by it',
              'refund needed' in q(f"select coalesce(review_flag,'') from orders where id='{o1}'") and q(f"select status from event_regs where id='{reg}'") == 'forming', (s_, j))
        await post(ca, '/api/checkout/demo-confirm', {'orderId': o2})
        check('#1 the new payment confirms the team', q(f"select status from event_regs where id='{reg}'") == 'confirmed')

        # ── Sup #1: bank UPI — no UTR frees after 30 min; with a UTR it stays (money may have left) ──
        ev2 = mkev('Fix UPI Hold', tmin=2, tmax=3, price=20000, slots=2)
        cd, sd = await login(b, 'fx5@seed.thefest.in'); await register(sd, ev2, 'Upi Folk')
        reg2 = q(f"select id from event_regs where event_id='{ev2}'"); join(reg2, ev2, 'fx6@seed.thefest.in')
        s_, j = await post(cd, '/api/checkout', {'registrationId': reg2, 'method': 'upi_direct'}); u1 = j.get('orderId')
        backdate(u1, 25)
        await sd.goto(f'{B}/my-events')
        check('#1 bank UPI without a UTR still holds at 25 minutes', await sd.locator('section[data-entry="Fix UPI Hold"] [data-pay-box]').count() == 0)
        backdate(u1, 35)
        await sd.goto(f'{B}/my-events')
        check('#1 bank UPI without a UTR is released after 30 minutes (Pay comes back)', await sd.locator('section[data-entry="Fix UPI Hold"] [data-pay-box]').count() == 1)
        # Tester F2 + F3: pay by bank UPI through the screen, send a UTR
        box = sd.locator('section[data-entry="Fix UPI Hold"] [data-pay-box]')
        pick = await box.inner_text()
        check('F3 payment choice says "entry", not "ticket"', 'entry confirmed in a few minutes' in pick and 'Instant entry' in pick and 'ticket' not in pick.lower(), pick)
        await box.locator('button:has-text("by UPI")').click()
        await sd.wait_for_selector('input[placeholder="412345678901"]')
        upi_txt = await box.inner_text()
        check('F3 UPI screen says "entry" ("delays your entry", "confirm my entry")', 'delays your entry' in upi_txt and 'confirm my entry' in upi_txt.lower() and 'ticket' not in upi_txt.lower(), upi_txt[:300])
        u2 = q(f"select id from orders where registration_id='{reg2}' and status='pending'")
        check('#1 the abandoned UPI order was released when the captain paid again', q(f"select status from orders where id='{u1}'") == 'failed' and u2 and u2 != u1, (u1, u2))
        await sd.fill('input[placeholder="412345678901"]', utr()); await sd.click('button:has-text("I’ve paid")')
        await sd.wait_for_url(lambda u: '/my-events' in u and 'utr=1' in u)
        body = await sd.inner_text('main')
        check('F2 after the UTR: "UTR sent — we’ll confirm once the payment is seen", never "confirmed"',
              'UTR sent — we’ll confirm once the payment is seen' in body and 'entry is confirmed' not in body and 'paid=1' not in sd.url, body[:300])
        backdate(u2, 45)
        await sd.goto(f'{B}/my-events'); sec = sd.locator('section[data-entry="Fix UPI Hold"]')
        check('#1 bank UPI with a UTR stays pending past 30 minutes (no Pay button, "UTR sent")',
              await sec.locator('[data-pay-box]').count() == 0 and 'UTR sent' in await sec.inner_text())
        ce, se = await login(b, 'fx6@seed.thefest.in'); await se.goto(f'{B}/my-events')
        m = await click_flash(se, 'section[data-entry="Fix UPI Hold"] button:has-text("Leave team")')
        check('#1 … and the team stays frozen while that UTR is checked', 'in progress' in m, m)
        await sd.goto(f'{B}/tickets')
        card = await sd.locator(f'a[href="/orders/{u2}"]').inner_text()
        check('Sup #4 / F3 My tickets pending card says "event entry", not "1 ticket"', 'event entry' in card and '1 ticket' not in card, card)
        await sd.goto(f'{B}/orders/{u2}'); ob = await sd.inner_text('main')
        check('F3 order page (UTR sent) says the entry is confirmed when the fest sees it', 'entry is confirmed as soon as' in ob and 'ticket appears' not in ob, ob[:300])
        # Owner confirms the UPI payment; Finance refunds it — the "send ₹X back" line must stay on screen (F4)
        await own.goto(f'{B}/organizer/{NEON}/payments')
        await own.locator(f'form:has(input[name=orderId][value="{u2}"]) button:has-text("Confirm")').click()
        for _ in range(40):
            if q(f"select status from orders where id='{u2}'") == 'paid': break
            await asyncio.sleep(0.25)
        await sd.goto(f'{B}/orders/{u2}')
        check('the confirmed UPI entry lands on My events', '/my-events' in sd.url and q(f"select status from event_regs where id='{reg2}'") == 'confirmed', sd.url)
        cf, fp = await login(b, 'finance@seed.thefest.in'); await fp.goto(f'{B}/organizer/{NEON}/sales?q=fx5@seed')
        await fp.locator(f'details:has(input[name=orderId][value="{u2}"]) summary').click()
        fm = fp.locator(f'form:has(input[name=orderId][value="{u2}"])'); ftxt = await fm.inner_text()
        check('F3 Sales refund form for an entry: no "Tickets to cancel"', 'Tickets to cancel' not in ftxt and 'event entry' in ftxt, ftxt)
        await fm.locator('input[name=reason]').fill('Clash with exam')
        m = await click_flash(fp, f'form:has(input[name=orderId][value="{u2}"]) button[type=submit]')
        amt = q(f"select amount_paise from orders where id='{u2}'")
        check('F4 Finance refund of a bank-UPI entry: "Send ₹X back by UPI" stays visible after the form goes',
              'Send ₹' in m and 'back to the student by UPI' in m and q(f"select status from orders where id='{u2}'") == 'refunded', (m, amt))

        # ── Sup #1: withdraw after an abandoned solo checkout ──
        ev3 = mkev('Fix Solo Withdraw', price=10000, slots=1)
        cg, sg = await login(b, 'fx7@seed.thefest.in'); await register(sg, ev3)
        reg3 = q(f"select id from event_regs where event_id='{ev3}'")
        s_, j = await post(cg, '/api/checkout', {'registrationId': reg3, 'method': 'gateway'}); backdate(j.get('orderId'), 16)
        await sg.goto(f'{B}/my-events')
        m = await click_flash(sg, 'section[data-entry="Fix Solo Withdraw"] button:has-text("Withdraw entry")')
        check('#1 captain can withdraw after an abandoned checkout; slot free; F4 message shown',
              'Entry withdrawn' in m and q(f"select status from event_regs where id='{reg3}'") == 'withdrawn' and taken(ev3) == 0, m)

        # ── Sup #2: late webhook vs new checkout — no deadlock, no waiting ──
        ev4 = mkev('Fix Deadlock', price=10000, slots=5)
        ch, sh_ = await login(b, 'fx8@seed.thefest.in'); await register(sh_, ev4)
        ci, si = await login(b, 'fx9@seed.thefest.in'); await register(si, ev4)
        regh = q(f"select id from event_regs where event_id='{ev4}' and captain_id='{uid('fx8@seed.thefest.in')}'")
        regi = q(f"select id from event_regs where event_id='{ev4}' and captain_id='{uid('fx9@seed.thefest.in')}'")
        tt4 = q(f"select ticket_type_id from events where id='{ev4}'")
        s_, j = await post(ch, '/api/checkout', {'registrationId': regh, 'method': 'gateway'}); oh = j.get('orderId'); backdate(oh, 20)
        # A "webhook" transaction: locks the expired order, then (after the checkout below) the slot counter — fulfilOrder's order
        ps = subprocess.Popen(DB.split() + ['-qtA'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        ps.stdin.write(f"begin;\nselect 'L' from orders where id='{oh}' for update;\n"); ps.stdin.flush()
        assert ps.stdout.readline().strip() == 'L'
        t0 = time.time()
        try: s_, j = await post(ci, '/api/checkout', {'registrationId': regi, 'method': 'gateway'}, timeout=8000)
        except Exception as e: s_, j = 0, {'error': str(e)}
        took = time.time() - t0
        check('#2 a new checkout doesn’t wait on an order a webhook has locked (skip locked)', s_ == 200 and took < 5, (s_, j, round(took, 2)))
        ps.stdin.write(f"select 'T' from ticket_types where id='{tt4}' for update;\nupdate orders set status='paid', paid_at=now() where id='{oh}';\nupdate ticket_types set sold = sold where id='{tt4}';\ncommit;\n")
        out, _ = ps.communicate(timeout=20)
        check('#2 the webhook side then takes the slot lock and commits — no deadlock', 'deadlock' not in out.lower() and 'ERROR' not in out and q(f"select status from orders where id='{oh}'") == 'paid', out)
        q(f"update orders set status='failed', paid_at=null where id='{oh}'"); q(f"update ticket_types set sold = greatest(sold - 1, 0) where id='{tt4}'")
        # the real thing in parallel: late demo confirms of expired orders while new checkouts release holds (5 rounds)
        errs = []
        for k in range(5):
            em = f'fxr{k}@seed.thefest.in'; mk(em, f'Racer Late{k}')
            cr, sr = await login(b, em); await register(sr, ev4)
            regr = q(f"select id from event_regs where event_id='{ev4}' and captain_id='{uid(em)}'")
            s_, j = await post(cr, '/api/checkout', {'registrationId': regr, 'method': 'gateway'}); orr = j.get('orderId'); backdate(orr, 20)
            em2 = f'fxs{k}@seed.thefest.in'; mk(em2, f'Racer New{k}')
            cs, ss = await login(b, em2); await register(ss, ev4)
            regs = q(f"select id from event_regs where event_id='{ev4}' and captain_id='{uid(em2)}'")
            (s1, j1), (s2, j2) = await asyncio.gather(post(cr, '/api/checkout/demo-confirm', {'orderId': orr}), post(cs, '/api/checkout', {'registrationId': regs, 'method': 'gateway'}))
            if s1 >= 500 or s2 >= 500: errs.append((s1, j1, s2, j2))
            if j2.get('orderId'): await post(cs, '/api/checkout/cancel', {'orderId': j2['orderId']})
            await cr.close(); await cs.close()
        dl = q("select count(*) from app_errors where message ilike '%deadlock%'")
        sold_ok = q(f"select tt.sold = (select count(*) from orders o where o.ticket_type_id = tt.id and o.status in ('paid','pending')) from ticket_types tt where tt.id='{tt4}'")
        check('#2 parallel late confirms + new checkouts: no server errors, no deadlock logged, slot count right', not errs and dl == '0' and sold_ok == 't', (errs, dl, sold_ok))

        # ── Sup #3 / F6 event CSV: no ₹ without money; one payment per team; no outstanding invitees ──
        bands = q(f"select id from events where fest_id='{NEON}' and title='Battle of Bands'")
        breg = q(f"select r.id from event_regs r where r.event_id='{bands}' and r.status='confirmed' order by r.created_at limit 1")
        q(f"insert into event_members (reg_id, event_id, email, status) values ('{breg}', '{bands}', 'outsider-invite@example.com', 'invited') on conflict do nothing")
        r = await oc.request.get(f'{B}/organizer/{NEON}/events/{bands}/export')
        rows = list(csv.DictReader(io.StringIO((await r.text()).lstrip('﻿'))))
        paid_teams = int(q(f"select count(distinct o.registration_id) from orders o join event_regs r on r.id=o.registration_id where r.event_id='{bands}' and o.status in ('paid','refunded')"))
        joined = int(q(f"select count(*) from event_members where event_id='{bands}' and status='joined'"))
        with_pay = [x for x in rows if x.get('paid_inr')]
        check('F6 owner CSV: the team payment is on one row per team (the captain’s), not per member',
              r.status == 200 and len(with_pay) == paid_teams and all(x['captain'] == 'true' for x in with_pay), (len(with_pay), paid_teams))
        check('F6 CSV leaves out invitees who haven’t joined', len(rows) == joined and not any(x['email'] == 'outsider-invite@example.com' for x in rows), (len(rows), joined))
        q("delete from event_members where email='outsider-invite@example.com'")
        chd, _ = await login(b, 'eventhead@seed.thefest.in')
        r = await chd.request.get(f'{B}/organizer/{NEON}/events/{bands}/export'); head = (await r.text()).lstrip('﻿').splitlines()[0]
        check('Sup #3 event head CSV has no ₹ column', r.status == 200 and 'paid_inr' not in head, head)

        # ── F7 no "Remove entry" on paid entries ──
        await own.goto(f'{B}/organizer/{NEON}/events/{bands}')
        paid_cards = own.locator('[data-entry]:has-text("Paid")')
        n_paid = await paid_cards.count()
        check('F7 paid entries: no "Remove entry"; points to a refund from Sales',
              n_paid > 0 and await own.locator('[data-entry]:has-text("Paid") button:has-text("Remove entry")').count() == 0
              and 'refund from Sales' in await paid_cards.first.inner_text(), n_paid)

        # ── Sup #5 Event counter respects can_scan per event-head row ──
        cs1, _ = await login(b, 'eventhead@seed.thefest.in', '/scan/login')
        code = q(f"select t.code from tickets t where t.fest_id='{NEON}' and t.status='valid' limit 1")
        q(f"update fest_roles set can_scan=false where email='eventhead@seed.thefest.in' and role='event_head' and event_id='{bands}'")
        s_, j = await post(cs1, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': bands, 'code': code})
        q(f"update fest_roles set can_scan=true where email='eventhead@seed.thefest.in' and role='event_head' and event_id='{bands}'")
        check('Sup #5 an event head with scanning off for that event can’t mark it', s_ == 403, (s_, j))
        s_, j = await post(cs1, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': bands, 'code': code})
        check('Sup #5 … and can again once scanning is on', s_ == 200, (s_, j))
        await cs1.close()

        # ── F8 scanner wording ──
        so, spg = await login(b, 'organizer@thefest.in', '/scan/login')
        solo = mkev('Fix Scan Solo', slots=5)
        await register(sa, solo)  # fx1: free solo → confirmed
        c1 = q(f"select code from tickets where user_id='{uid('fx1@seed.thefest.in')}' and fest_id='{NEON}' and status<>'void' limit 1")
        await post(so, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': solo, 'code': c1})
        s_, j = await post(so, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': solo, 'code': c1})
        check('F8 solo rescan: event name shown once (as the type), not repeated in the message',
              j.get('result') == 'duplicate' and 'Fix Scan Solo' not in j.get('message', '') and j.get('type') == 'Fix Scan Solo', j)
        fteam = mkev('Fix Scan Forming', tmin=2, tmax=3, slots=5)
        await register(sc, fteam, 'Still Forming')  # fx3 captain, forming
        c3 = q(f"select code from tickets where user_id='{uid('fx3@seed.thefest.in')}' and fest_id='{NEON}' and status<>'void' limit 1")
        s_, j = await post(so, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': fteam, 'code': c3})
        check('F8 forming team member → one clear "Team not confirmed yet"', j.get('result') == 'invalid' and j.get('headline') == '✕ Team not confirmed yet' and 'Not in this event' not in str(j), j)
        await spg.goto(f'{B}/scan?fest={NEON}&counter=event&event={fteam}')
        await spg.fill('input[aria-label="Ticket code"]', c3); await spg.click('form button:has-text("Check")')
        await spg.wait_for_selector('.verdict'); v = await spg.inner_text('.verdict')
        check('F8 scanner screen shows "Team not confirmed yet" (not "Not in this event")', 'Team not confirmed yet' in v and 'Not in this event' not in v, v)
        await so.close()

        # ── F4 flash on the student forms that remove themselves; F5 no name before accepting ──
        tf = mkev('Fix Flash Team', tmin=2, tmax=2, slots=5)
        await register(sa, tf, 'Flashers')
        sec = 'section[data-entry="Fix Flash Team"]'
        await sa.goto(f'{B}/my-events'); await sa.fill(f'{sec} input[name=email]', 'fx10@seed.thefest.in')
        m = await click_flash(sa, f'{sec} form:has(input[name=email]) button[type=submit]')
        txt = await sa.locator(sec).inner_text()
        check('F4 the invite that fills the team: "Invite sent" stays visible though the invite box goes', 'Invite sent to fx10@seed.thefest.in' in m and await sa.locator(f'{sec} input[name=email]').count() == 0, m)
        check('F5 captain sees only the invitee’s email before they accept (not their account name)', 'fx10@seed.thefest.in' in txt and 'Fixa Tester10' not in txt, txt)
        m = await click_flash(sa, f'{sec} button:has-text("Cancel invite")')
        check('F4 "Invite cancelled." stays visible', 'Invite cancelled' in m, m)
        await sa.goto(f'{B}/my-events'); await sa.fill(f'{sec} input[name=email]', 'fx10@seed.thefest.in')
        await click_flash(sa, f'{sec} form:has(input[name=email]) button[type=submit]')
        cj, sj = await login(b, 'fx10@seed.thefest.in'); await sj.goto(f'{B}/my-events')
        m = await click_flash(sj, '[data-invite="Fix Flash Team"] button:has-text("Accept")')
        check('F4 "You joined …" stays visible after Accept', 'You joined' in m and q(f"select count(*) from event_members m join users u on u.id=m.user_id where m.event_id='{tf}' and u.email='fx10@seed.thefest.in' and m.status='joined'") == '1', m)
        await sa.goto(f'{B}/my-events')
        check('F5 after accepting, the captain sees their name', 'Fixa Tester10' in await sa.locator(sec).inner_text())
        m = await click_flash(sa, f'{sec} [data-submit]')
        check('F4 "Team submitted" stays visible after Submit team', 'Team submitted' in m and q(f"select status from event_regs where event_id='{tf}'") == 'confirmed', m)

        # ── F1 Sales "Tickets" counts tickets only (Collected includes entries) ──
        await own.goto(f'{B}/organizer/{NEON}/sales')
        shown = (await own.locator('.stat:has(.label:text-is("Tickets")) .v').inner_text()).replace(',', '')
        tix = q(f"select count(*) from tickets where fest_id='{NEON}' and status <> 'void'")
        check('F1 Sales "Tickets" = ticket rows (event entries and add-ons not counted)', shown == tix, (shown, tix))

        # ── F9 Add-event date defaults to the next fest day still ahead (or empty) ──
        se_, ee_ = q(f"select starts_on || '|' || ends_on from fests where id='{NEON}'").split('|')
        today = datetime.now(ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
        want = '' if today > ee_ else (today if today > se_ else se_)
        await own.goto(f'{B}/organizer/{NEON}/events')
        got = await own.locator('#add-event input[name=date]').input_value()
        check('F9 Add-event date = next fest day still ahead (or empty after the fest)', got == want, (got, want))

        # ── Sup #6 deleting a fest that has events and entries (no orders) works; an event with entries can't be deleted ──
        q("insert into fests (organizer_id, slug, name, college, city, starts_on, ends_on) select id, 'fix-del-fest', 'Fix Del Fest', 'X', 'Y', current_date + 5, current_date + 6 from users where email='organizer@thefest.in'")
        fd = q("select id from fests where slug='fix-del-fest'")
        q(f"with t as (insert into ticket_types (fest_id, name, price_paise, quota, kind) values ('{fd}', 'Event: Delete me', 0, 5, 'event') returning id) "
          f"insert into events (fest_id, category, title, starts_at, slots, reg_deadline, ticket_type_id) select '{fd}', 'other', 'Delete me', now() + interval '5 days', 5, now() + interval '4 days', id from t")
        fe = q(f"select id from events where fest_id='{fd}'")
        q(f"with r as (insert into event_regs (event_id, fest_id, captain_id, status) values ('{fe}', '{fd}', '{uid('fx1@seed.thefest.in')}', 'confirmed') returning id) "
          f"insert into event_members (reg_id, event_id, email, user_id, status) select r.id, '{fe}', 'fx1@seed.thefest.in', '{uid('fx1@seed.thefest.in')}', 'joined' from r")
        out = subprocess.run(DB + f" -qtAc \"delete from fests where id='{fd}'\"", shell=True, capture_output=True, text=True)
        check('Sup #6 a fest with events and entries (no orders) deletes cleanly with everything under it',
              out.returncode == 0 and 'ERROR' not in out.stderr and q(f"select count(*) from events where id='{fe}'") == '0'
              and q("select count(*) from ticket_types where name='Event: Delete me'") == '0', out.stderr)
        await b.close()

    failed = [n for n, ok in results if not ok]
    print(f'\nevents-fix1: {len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())

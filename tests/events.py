# Fest events, part A (v2.8, Oct 25 2026) — docs/team/research/2026-10-25-fest-events.md, acceptance criteria 1–14.
# Runs on the seeded local database and the server on :3000 (run-e2e.sh, DEMO_PAYMENTS=1); an old-database server on :3009.
import asyncio, csv, io, math, os, signal, subprocess, time, urllib.request, urllib.error
from playwright.async_api import async_playwright
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e'); SHOTS = E2E + '/'
MOBILE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + 'events: ' + name + (f'  [{extra}]' if extra not in ('', None) else ''))
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql.replace('"', '\\"') + '"', shell=True, capture_output=True, text=True).stdout.strip()
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)

NEON = q("select id from fests where slug='neon-utsav'")
HACK = q("select id from fests where slug='hackverse'")
COL = 'Demo Institute of Technology'
def mk(em, nm, college=COL, ticket=False, verified='now()'):
    q(f"insert into users (email, password_hash, name, role, college, email_verified_at) select '{em}', password_hash, '{nm}', 'student', '{college}', {verified} from users where email='student@thefest.in' on conflict (email) do nothing")
    if ticket:  # a free Neon Utsav ticket (an order + a valid ticket)
        q(f"with o as (insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, provider, method, status, paid_at) "
          f"select u.id, '{NEON}', (select id from ticket_types where fest_id='{NEON}' and kind='entry' order by sort limit 1), 1, 0, 'free', 'free', 'paid', now() from users u where u.email='{em}' returning id, user_id) "
          f"insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name) select 'TF-' || upper(substr(md5(o.id::text), 1, 4)) || '-' || upper(substr(md5(o.id::text), 5, 4)), o.id, o.user_id, '{NEON}', "
          f"(select id from ticket_types where fest_id='{NEON}' and kind='entry' order by sort limit 1), '{nm}' from o")
def mkev(title, tmin=1, tmax=1, price=0, slots=10, mixed=True, needs=False, fest=None, deadline="now() + interval '1 day'", cat='technical'):
    f = fest or NEON
    q(f"with t as (insert into ticket_types (fest_id, name, description, price_paise, quota, sold, sort, kind) values ('{f}', 'Event: {title}', '', {price}, {slots}, 0, 1000, 'event') returning id) "
      f"insert into events (fest_id, category, title, starts_at, team_min, team_max, price_paise, slots, reg_deadline, mixed_colleges, needs_ticket, ticket_type_id) "
      f"select '{f}', '{cat}', '{title}', now() + interval '2 days', {tmin}, {tmax}, {price}, {slots}, {deadline}, {str(mixed).lower()}, {str(needs).lower()}, t.id from t")
    return q(f"select id from events where title='{title}' and fest_id='{f}'")
uid = lambda em: q(f"select id from users where email='{em}'")
taken = lambda ev: int(q(f"select tt.sold from events e join ticket_types tt on tt.id=e.ticket_type_id where e.id='{ev}'"))

async def login(b, email, url='/login', opts=None):
    c = await b.new_context(**(opts or {})); pg = await c.new_page()
    await pg.goto(B + url); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return c, pg
async def token(c, name='tf_session'): return next(k['value'] for k in await c.cookies() if k['name'] == name)
async def no_hscroll(pg): return await pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
async def alert(pg, timeout=8000):
    loc = pg.locator('.alert.error, .alert.ok').first
    try: await loc.wait_for(timeout=timeout); return await loc.inner_text()
    except Exception: return ''
async def submit(pg, form_sel, btn=None):
    form = pg.locator(form_sel).first
    await (form.locator(btn) if btn else form.locator('button[type=submit]')).first.click()
    await pg.wait_for_timeout(300)
    return await alert(pg)
async def post(c, path, data):
    r = await c.request.post(B + path, data=data, headers={'Origin': B})
    try: j = await r.json()
    except Exception: j = {}
    return r.status, j

class Server:  # an extra server against another database (same pattern as tests/sponsor_leads.py)
    def __init__(self, port, db_url):
        self.base = f'http://localhost:{port}'
        e = os.environ.copy(); e.update(DATABASE_URL=db_url, PORT=str(port), DEMO_PAYMENTS='', E2E_ERROR_ROUTE='', ADMIN_EMAILS='')
        self.log = open(f'{E2E}/server-{port}.log', 'a')
        self.p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', str(port)], cwd=ROOT, env=e, stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            try: urllib.request.urlopen(self.base + '/legal/terms', timeout=3); return
            except urllib.error.HTTPError: return
            except Exception: time.sleep(0.5)
        raise RuntimeError('server did not start')
    def stop(self):
        try: os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        self.p.wait(15); self.log.close()

async def main():
    # Test people: verified students; colleges matter for "one college per team"
    for i in range(1, 13): mk(f'ev{i}@seed.thefest.in', f'Evi Tester{i}', ticket=(i <= 8))
    mk('evother@seed.thefest.in', 'Olu Othercollege', college='Sample School of Design', ticket=True)
    mk('evblank@seed.thefest.in', 'Bina Blank', college='', ticket=True)
    mk('evnoticket@seed.thefest.in', 'Nico Noticket')
    mk('evunver@seed.thefest.in', 'Una Unverified', verified='null')
    # earlier suites remove media@'s judge role (team_roles AC11): put the seeded judge link back
    q(f"insert into fest_roles (fest_id, email, name, role, scope_label, event_id) select '{NEON}', 'media@seed.thefest.in', 'Meera Media', 'judge', title, id from events where fest_id='{NEON}' and title='Battle of Bands' on conflict do nothing")
    q(f"update fests set upi_enabled = true, upi_vpa = coalesce(upi_vpa, 'neonutsav@icici') where id = '{NEON}'")
    async with async_playwright() as p:
        b = await p.chromium.launch()
        oc, own = await login(b, 'organizer@thefest.in')

        # ── AC1 organizer adds an event through the form; 7 categories; limits; edit (slots ≥ taken); hide; delete only without entries ──
        await own.goto(f'{B}/organizer/{NEON}/events')
        cats = await own.locator('#add-event select[name=category] option').evaluate_all('els => els.map(e => e.value)')
        check('AC1 category list is the fixed 7', cats == ['cultural', 'management', 'technical', 'sports', 'literary', 'gaming', 'other'], cats)
        f = '#add-event form'
        await own.fill(f'{f} input[name=title]', 'X' * 81)  # maxLength stops typing past 80 in the browser; force it
        await own.evaluate("document.querySelector('#add-event input[name=title]').removeAttribute('maxlength')")
        await own.fill(f'{f} input[name=title]', 'X' * 81); await own.fill(f'{f} input[name=slots]', '5')
        m = await submit(own, f)
        check('AC1 title over 80 characters refused', '2 to 80' in m, m)
        await own.fill(f'{f} input[name=title]', 'Robo Race')
        await own.fill(f'{f} input[name=slots]', '0'); await own.evaluate("document.querySelector('#add-event input[name=slots]').removeAttribute('min')")
        m = await submit(own, f)
        check('AC1 slots 0 refused', 'Slots' in m, m)
        await own.select_option(f'{f} select[name=category]', 'gaming')
        await own.check(f'{f} input[name=format][value=team]'); await own.fill(f'{f} input[name=team_min]', '2'); await own.fill(f'{f} input[name=team_max]', '3')
        await own.check(f'{f} input[name=fee][value=paid]'); await own.fill(f'{f} input[name=price]', '150'); await own.fill(f'{f} input[name=slots]', '4')
        m = await submit(own, f)
        row = q("select category, team_min, team_max, price_paise, slots from events where title='Robo Race'")
        check('AC1 owner adds a paid team event through the form', 'added' in m and row == 'gaming|2|3|15000|4', (m, row))
        robo = q("select id from events where title='Robo Race'")
        check('AC1 its hidden slot counter is an event-kind ticket type (not on the Tickets tab)',
              q(f"select tt.kind || '|' || tt.quota from events e join ticket_types tt on tt.id=e.ticket_type_id where e.id='{robo}'") == 'event|4'
              and 'Robo Race' not in await (await own.goto(f'{B}/organizer/{NEON}/tickets')) .text())
        for c in cats: mkev(f'Cat {c}', cat=c)
        await own.goto(f'{B}/organizer/{NEON}/events')
        shown = await own.locator('section[data-category]').evaluate_all('els => els.map(e => e.dataset.category)')
        check('AC1 Events tab groups events under all 7 categories', all(c in shown for c in cats), shown)

        # ── AC3 solo free: instant confirm; second registration refused ──
        solo = mkev('Solo Free Test', slots=3, cat='literary')
        c1, s1 = await login(b, 'ev1@seed.thefest.in')
        await s1.goto(f'{B}/fests/neon-utsav/events/{solo}')
        await s1.click('#register button[type=submit]'); await s1.wait_for_url('**/my-events**')
        st = q(f"select r.status from event_regs r where r.event_id='{solo}' and r.captain_id='{uid('ev1@seed.thefest.in')}'")
        check('AC3 solo free registration confirms instantly and takes a slot', st == 'confirmed' and taken(solo) == 1, (st, taken(solo)))
        await s1.goto(f'{B}/fests/neon-utsav/events/{solo}')
        check('AC3 event page then says "You’re in" (no second Register button)', 'You’re in this event' in await s1.inner_text('#register'))
        # forged second registration (form posted again from an old page)
        c1b = await b.new_context(); await c1b.add_cookies([{'name': 'tf_session', 'value': await token(c1), 'url': B}])
        q(f"update event_regs set status='forming' where event_id='{solo}' and false")
        p1b = await c1b.new_page(); await p1b.goto(f'{B}/fests/neon-utsav/events/{solo}')
        check('AC3 second registration by the same student is refused', await p1b.locator('#register button[type=submit]').count() == 0
              and q(f"select count(*) from event_members where event_id='{solo}' and user_id='{uid('ev1@seed.thefest.in')}' and status='joined'") == '1')
        await c1b.close()

        # ── AC2 fest page cards: fee text, slots left, Full, Closed, hidden not shown ──
        full = mkev('Full Test', slots=1, cat='sports'); q(f"update ticket_types set sold = 1 where id = (select ticket_type_id from events where id='{full}')")
        closed = mkev('Closed Test', deadline="now() - interval '1 hour'", cat='sports')
        hidden = mkev('Hidden Test', cat='sports'); q(f"update events set active=false where id='{hidden}'")
        mkev('Paid Fee Text', price=20000, cat='sports'); mkev('Ticket Needed Text', needs=True, cat='sports')
        await s1.goto(f'{B}/fests/neon-utsav?cat=sports#events')
        card = lambda t: s1.locator(f'[data-event-card="{t}"]')
        txt = {t: await card(t).inner_text() for t in ['Full Test', 'Closed Test', 'Paid Fee Text', 'Ticket Needed Text']}
        check('AC2 cards: "Full" at taken = slots, "Closed" after deadline', 'Full' in txt['Full Test'] and 'Closed' in txt['Closed Test'], txt)
        check('AC2 fee text "₹200 + ₹5 fee" and "Free · fest ticket needed"', '₹200 + ₹5 fee' in txt['Paid Fee Text'] and 'Free · fest ticket needed' in txt['Ticket Needed Text'], txt)
        check('AC2 hidden events don’t show; category chip filters', await card('Hidden Test').count() == 0 and await card('Solo Singing').count() == 0)
        await s1.goto(f'{B}/fests/neon-utsav#events')
        check('AC2 seeded cards: slots left text, team text', '1 slot left' in (await card('BGMI Showdown').inner_text()).lower() and 'Team of 3–6' in await card('Battle of Bands').inner_text())
        r = await s1.goto(f'{B}/fests/neon-utsav/events/{hidden}')
        check('AC2 hidden event page is not found', r.status == 404, r.status)

        # ── AC4 / AC5 team: invite, accept, rules (max, deadline, other team, fest ticket, college) ──
        team = mkev('Team Rules Test', tmin=2, tmax=3, slots=5, mixed=False, needs=True, cat='management')
        await s1.goto(f'{B}/fests/neon-utsav/events/{team}')
        await s1.fill('#register input[name=team_name]', 'Rule Breakers'); await s1.click('#register button[type=submit]'); await s1.wait_for_url('**/my-events**')
        reg = q(f"select id from event_regs where event_id='{team}'")
        sec = f'section[data-entry="Team Rules Test"]'
        check('AC5 "Submit team" disabled until joined ≥ min', await s1.locator(f'{sec} [data-submit]').is_disabled())
        async def invite(pg, email):
            await pg.goto(f'{B}/my-events'); await pg.fill(f'{sec} input[name=email]', email); return await submit(pg, f'{sec} form:has(input[name=email])')
        await invite(s1, 'ev2@seed.thefest.in')
        stale = await c1.new_page(); await stale.goto(f'{B}/my-events')   # still shows the invite box (one place left)
        await invite(s1, 'evother@seed.thefest.in')
        check('AC4 invite box disappears at max size', await s1.locator(f'{sec} input[name=email]').count() == 0)
        await stale.fill(f'{sec} input[name=email]', 'evblank@seed.thefest.in'); m = await submit(stale, f'{sec} form:has(input[name=email])')
        check('AC4 invites stop at max size (joined + open invites), even from an old page', q(f"select count(*) from event_members where reg_id='{reg}' and status='invited'") == '2', m)
        await stale.close()
        async def accept(email, title='Team Rules Test'):
            c, pg = await login(b, email); await pg.goto(f'{B}/my-events')
            m = await submit(pg, f'[data-invite="{title}"] form:has(input[value=accept])'); await c.close(); return m
        m = await accept('evother@seed.thefest.in')
        check('AC4 accept refused when college differs from the captain’s (mixed not allowed)', 'college' in m and q(f"select status from event_members where reg_id='{reg}' and email='evother@seed.thefest.in'") == 'invited', m)
        q(f"insert into event_members (reg_id, event_id, email, user_id, status) select '{reg}', '{team}', email, id, 'invited' from users where email in ('evblank@seed.thefest.in', 'evnoticket@seed.thefest.in')")
        m = await accept('evblank@seed.thefest.in')
        check('AC4 accept refused when the college is blank', 'college' in m.lower(), m)
        m = await accept('evnoticket@seed.thefest.in')
        check('AC4 accept refused without a fest ticket when the event needs one', 'fest ticket' in m or 'ticket for' in m, m)
        other = mkev('Other Team Event', tmin=1, tmax=3, slots=5, cat='management')
        q(f"insert into event_regs (event_id, fest_id, captain_id, team_name) values ('{team}', '{NEON}', '{uid('ev3@seed.thefest.in')}', 'Rivals') ")
        rival = q(f"select id from event_regs where team_name='Rivals'")
        q(f"insert into event_members (reg_id, event_id, email, user_id, status, joined_at) values ('{rival}', '{team}', 'ev3@seed.thefest.in', '{uid('ev3@seed.thefest.in')}', 'joined', now()), ('{rival}', '{team}', 'ev2@seed.thefest.in', '{uid('ev2@seed.thefest.in')}', 'joined', now())")
        m = await accept('ev2@seed.thefest.in')
        check('AC4 accept refused when already in another team of that event', 'already in a team' in m, m)
        q(f"update event_members set status='left' where reg_id='{rival}' and email='ev2@seed.thefest.in'")
        m = await accept('ev2@seed.thefest.in')
        check('AC4 invitee accepts from My events', q(f"select status from event_members where reg_id='{reg}' and email='ev2@seed.thefest.in'") == 'joined', m)
        await s1.goto(f'{B}/my-events')
        check('AC5 Submit enabled once joined ≥ min', not await s1.locator(f'{sec} [data-submit]').is_disabled())
        m = await submit(s1, f'{sec} form:has([data-submit])')
        check('AC5 free team submitted → confirmed, slot taken', q(f"select status from event_regs where id='{reg}'") == 'confirmed' and taken(team) == 1, m)
        c2, s2 = await login(b, 'ev2@seed.thefest.in'); await s2.goto(f'{B}/my-events')
        m = await submit(s2, f'{sec} form:has(button:has-text("Leave team"))')
        check('AC5 leave blocked when it would drop a confirmed team below min', 'below 2' in m and q(f"select status from event_members where reg_id='{reg}' and email='ev2@seed.thefest.in'") == 'joined', m)
        q(f"update events set reg_deadline = now() - interval '1 minute' where id='{team}'")
        q(f"insert into event_members (reg_id, event_id, email, user_id, status) values ('{reg}', '{team}', 'ev4@seed.thefest.in', '{uid('ev4@seed.thefest.in')}', 'invited')")
        m = await accept('ev4@seed.thefest.in')
        check('AC4 accept refused after the deadline', 'closed' in m, m)
        await s1.goto(f'{B}/my-events')
        mid = q(f"select id from event_members where reg_id='{reg}' and email='ev2@seed.thefest.in'")
        await s1.evaluate(f"""() => {{ const f = document.querySelector('{sec} form:has(input[name=email])') || document.querySelector('{sec} form'); }}""")
        # captain removes after deadline: forge the remove form (no button after the deadline? it still shows) and expect refusal
        rm = s1.locator(f'{sec} [data-member="Evi Tester2"] form')
        m = await submit(s1, f'{sec} [data-member="Evi Tester2"] form') if await rm.count() else 'no button'
        check('AC5 remove blocked after the deadline', q(f"select status from event_members where id='{mid}'") == 'joined', m)
        await c2.close()

        # ── RACE 6 parallel accepts on a 3-max team; same student accepting two teams at once ──
        rt = mkev('Race Team', tmin=1, tmax=3, slots=5, cat='other')
        q(f"insert into event_regs (event_id, fest_id, captain_id, team_name) values ('{rt}', '{NEON}', '{uid('ev5@seed.thefest.in')}', 'Racers')")
        rreg = q(f"select id from event_regs where event_id='{rt}'")
        q(f"insert into event_members (reg_id, event_id, email, user_id, status, joined_at) values ('{rreg}', '{rt}', 'ev5@seed.thefest.in', '{uid('ev5@seed.thefest.in')}', 'joined', now())")
        racers = [f'ev{i}@seed.thefest.in' for i in (6, 7, 8, 9, 10, 11)]
        for em in racers: q(f"insert into event_members (reg_id, event_id, email, user_id, status) values ('{rreg}', '{rt}', '{em}', '{uid(em)}', 'invited')")
        pages = []
        for em in racers:
            c, pg = await login(b, em); await pg.goto(f'{B}/my-events'); pages.append((c, pg))
        await asyncio.gather(*[pg.locator('[data-invite="Race Team"] form:has(input[value=accept]) button').click() for _, pg in pages])
        await asyncio.sleep(2.5)
        n = q(f"select count(*) from event_members where reg_id='{rreg}' and status='joined'")
        check('RACE 6 parallel accepts on a 3-max team → exactly 3 members', n == '3', n)
        for c, _ in pages: await c.close()
        two = mkev('Two Teams', tmin=1, tmax=3, slots=5, cat='other')
        for cap, tn in (('ev9@seed.thefest.in', 'Alpha'), ('ev10@seed.thefest.in', 'Beta')):
            q(f"insert into event_regs (event_id, fest_id, captain_id, team_name) values ('{two}', '{NEON}', '{uid(cap)}', '{tn}')")
            r_ = q(f"select id from event_regs where team_name='{tn}' and event_id='{two}'")
            q(f"insert into event_members (reg_id, event_id, email, user_id, status, joined_at) values ('{r_}', '{two}', '{cap}', '{uid(cap)}', 'joined', now())")
            q(f"insert into event_members (reg_id, event_id, email, user_id, status) values ('{r_}', '{two}', 'ev12@seed.thefest.in', '{uid('ev12@seed.thefest.in')}', 'invited')")
        c12, pa = await login(b, 'ev12@seed.thefest.in'); pb = await c12.new_page()
        await pa.goto(f'{B}/my-events'); await pb.goto(f'{B}/my-events')
        fa = pa.locator('[data-invite="Two Teams"] form:has(input[value=accept]) button')
        await asyncio.gather(fa.nth(0).click(), pb.locator('[data-invite="Two Teams"] form:has(input[value=accept]) button').nth(1).click())
        await asyncio.sleep(2)
        n = q(f"select count(*) from event_members where event_id='{two}' and user_id='{uid('ev12@seed.thefest.in')}' and status='joined'")
        check('RACE same student accepting two teams at once → in exactly one', n == '1', n)
        await c12.close()

        # ── RACE 10 parallel free registrations on a 1-slot event → exactly 1 ──
        one = mkev('One Slot Free', slots=1, cat='other')
        regs = []
        for i in range(1, 11):
            em = f'ev{i}@seed.thefest.in'
            c, pg = await login(b, em); await pg.goto(f'{B}/fests/neon-utsav/events/{one}'); regs.append((c, pg))
        await asyncio.gather(*[pg.click('#register button[type=submit]') for _, pg in regs])
        await asyncio.sleep(3)
        n = q(f"select count(*) from event_regs where event_id='{one}' and status='confirmed'")
        check('RACE 10 parallel registrations on a 1-slot event → exactly 1 confirmed, sold = 1', n == '1' and taken(one) == 1 and q(f"select count(*) from event_regs where event_id='{one}'") == '1', (n, taken(one)))
        for c, _ in regs: await c.close()

        # ── AC6 / AC7 paid event: fee maths on demo + bank UPI, idempotent confirm, no tickets, not counted as tickets ──
        paid = mkev('Paid Solo Test', price=20000, slots=1, cat='other')
        ca, sa = await login(b, 'ev6@seed.thefest.in'); cb, sb = await login(b, 'ev7@seed.thefest.in')
        for pg in (sa, sb):
            await pg.goto(f'{B}/fests/neon-utsav/events/{paid}'); await pg.click('#register button[type=submit]'); await pg.wait_for_url('**/my-events**')
        rega = q(f"select id from event_regs where event_id='{paid}' and captain_id='{uid('ev6@seed.thefest.in')}'")
        regb = q(f"select id from event_regs where event_id='{paid}' and captain_id='{uid('ev7@seed.thefest.in')}'")
        check('AC6 paid solo: entry waits for payment (no slot yet), My events shows the pay box', taken(paid) == 0 and await sa.locator('[data-pay-box]').count() == 1)
        gw = math.ceil(20500 * 0.0236 / (1 - 0.0236))
        s_, j = await post(ca, '/api/checkout', {'registrationId': rega, 'method': 'gateway'})
        oa = j.get('orderId')
        row = q(f"select amount_paise, platform_fee_paise, gateway_fee_paise, qty from orders where id='{oa}'") if oa else ''
        check('AC6 card checkout total = ₹200 + ₹5 + gateway charge; platform_fee_paise = 500', s_ == 200 and j.get('mode') == 'demo' and row == f'{20500 + gw}|500|{gw}|1', (s_, j, row))
        s_, j = await post(cb, '/api/checkout', {'registrationId': regb, 'method': 'gateway'})
        check('AC7 second student while the only slot is held → "full"', s_ == 409 and 'full' in j.get('error', ''), (s_, j))
        s_, j = await post(ca, '/api/checkout', {'registrationId': regb})
        check('AC6 only the captain can pay for an entry', s_ == 409 and 'captain' in j.get('error', ''), (s_, j))
        # abandoned checkout: the hold expires, the slot frees, B buys it; A's late payment goes on the refund list
        q(f"update orders set created_at = now() - interval '20 minutes' where id='{oa}'")
        s_, j = await post(cb, '/api/checkout', {'registrationId': regb, 'method': 'gateway'})
        ob = j.get('orderId')
        check('AC7 an abandoned checkout frees its slot after the hold', s_ == 200 and q(f"select status from orders where id='{oa}'") == 'failed', (s_, j))
        r1, r2 = await asyncio.gather(post(cb, '/api/checkout/demo-confirm', {'orderId': ob}), post(cb, '/api/checkout/demo-confirm', {'orderId': ob}))
        r3 = await post(cb, '/api/checkout/demo-confirm', {'orderId': ob})
        check('AC6 confirm called three times (two at once) → confirmed once, no ticket rows',
              q(f"select status from event_regs where id='{regb}'") == 'confirmed' and taken(paid) == 1 and q(f"select count(*) from tickets where order_id='{ob}'") == '0'
              and q(f"select count(*) from orders where registration_id='{regb}' and status='paid'") == '1', (r1, r2, r3))
        s_, j = await post(ca, '/api/checkout/demo-confirm', {'orderId': oa})
        check('AC7 payment landing after the slot was taken → refund list, entry not confirmed', s_ == 409 and 'refund needed' in q(f"select coalesce(review_flag,'') from orders where id='{oa}'")
              and q(f"select status from event_regs where id='{rega}'") == 'forming' and taken(paid) == 1, (s_, j))
        await sb.goto(f'{B}/my-events?paid=1')
        check('AC6 My events shows the entry Confirmed', 'confirmed' in (await sb.locator('section[data-entry="Paid Solo Test"] [data-status]').inner_text()).lower())
        # bank UPI: no gateway charge, paise tag
        upi = mkev('Paid UPI Test', price=20000, slots=5, cat='other')
        await sa.goto(f'{B}/fests/neon-utsav/events/{upi}'); await sa.click('#register button[type=submit]'); await sa.wait_for_url('**/my-events**')
        regu = q(f"select id from event_regs where event_id='{upi}'")
        s_, j = await post(ca, '/api/checkout', {'registrationId': regu, 'method': 'upi_direct'})
        amt = j.get('amount', 0)
        check('AC6 bank UPI total = ₹205 + a few paise tag (no gateway charge), fee 500', s_ == 200 and j.get('mode') == 'upi' and 20501 <= amt <= 22499
              and q(f"select platform_fee_paise || '|' || gateway_fee_paise from orders where id='{j.get('orderId')}'") == '500|0', (s_, j))
        await post(ca, '/api/checkout/cancel', {'orderId': j.get('orderId')})
        check('AC6 cancelled UPI checkout releases the slot', taken(upi) == 0)
        # not tickets: 10-ticket cap and ticket analytics ignore entries; revenue includes them
        cap_ok = q(f"select coalesce(sum(qty),0) from orders where user_id='{uid('ev7@seed.thefest.in')}' and fest_id='{NEON}' and status in ('paid','pending') and addon_for is null and registration_id is null")
        check('AC6 event orders don’t count toward the 10-ticket cap', cap_ok == '1', cap_ok)
        await own.goto(f'{B}/organizer/{NEON}/analytics')
        body = await own.inner_text('.main')
        tix = q(f"select count(*) from tickets where fest_id='{NEON}' and status <> 'void'")
        gross = int(q(f"select sum(amount_paise - refunded_paise) from orders where fest_id='{NEON}' and status in ('paid','refunded')"))
        check('AC6 analytics: ticket count excludes entries; event types not in the per-type list', 'Paid Solo Test' not in body and 'Event:' not in body, tix)
        check('AC6 revenue totals include event entries', gross > int(q(f"select sum(amount_paise - refunded_paise) from orders o where fest_id='{NEON}' and status in ('paid','refunded') and registration_id is null")))

        # ── AC8 refunds: owner/Finance only; full amount; entry Refunded; slot freed; fest cancel refunds entries ──
        tok = {}
        for k, em in (('co', 'cohost@seed.thefest.in'), ('head', 'eventhead@seed.thefest.in'), ('judge', 'media@seed.thefest.in'), ('fin', 'finance@seed.thefest.in')):
            c, _ = await login(b, em); tok[k] = (c, await token(c))
        async def forge_refund(as_tok, order):
            c = await b.new_context(); await c.add_cookies([{'name': 'tf_session', 'value': await token(oc), 'url': B}])
            pg = await c.new_page(); await pg.goto(f'{B}/organizer/{NEON}/sales?q=ev7@seed')
            await pg.locator(f'details:has(input[name=orderId][value="{order}"]) summary').click()
            fm = pg.locator(f'form:has(input[name=orderId][value="{order}"])'); await fm.locator('input[name=reason]').fill('Forged refund')
            await c.add_cookies([{'name': 'tf_session', 'value': as_tok, 'url': B}])
            try:
                async with pg.expect_response(lambda r: r.request.method == 'POST', timeout=8000): await fm.locator('button[type=submit]').click()
            except Exception: pass
            await asyncio.sleep(0.4); await c.close()
        for k in ('co', 'head', 'judge'): await forge_refund(tok[k][1], ob)
        check('AC8 co-organizer, event head and judge cannot refund an entry', q(f"select status || '|' || refunded_paise from orders where id='{ob}'") == 'paid|0')
        fc = tok['fin'][0]; fp = await fc.new_page(); await fp.goto(f'{B}/organizer/{NEON}/sales?q=ev7@seed')
        await fp.locator(f'details:has(input[name=orderId][value="{ob}"]) summary').click()
        fm = fp.locator(f'form:has(input[name=orderId][value="{ob}"])'); await fm.locator('input[name=reason]').fill('Clash with exam')
        await fm.locator('button[type=submit]').click()
        for _ in range(40):
            if q(f"select status from orders where id='{ob}'") == 'refunded': break
            await asyncio.sleep(0.25)
        check('AC8 Finance lead refunds: full amount back, entry Refunded, slot freed',
              q(f"select refunded_paise = amount_paise from orders where id='{ob}'") == 't' and q(f"select status from event_regs where id='{regb}'") == 'refunded' and taken(paid) == 0)
        await sb.goto(f'{B}/my-events'); check('AC8 student sees Refunded', 'refunded' in (await sb.locator('section[data-entry="Paid Solo Test"] [data-status]').inner_text()).lower())
        hev = mkev('Hack Paid', price=10000, slots=3, fest=HACK)
        cx, sx = await login(b, 'ev8@seed.thefest.in')
        await sx.goto(f'{B}/fests/hackverse/events/{hev}'); await sx.click('#register button[type=submit]'); await sx.wait_for_url('**/my-events**')
        hreg = q(f"select id from event_regs where event_id='{hev}'")
        s_, j = await post(cx, '/api/checkout', {'registrationId': hreg}); await post(cx, '/api/checkout/demo-confirm', {'orderId': j.get('orderId')})
        await own.goto(f'{B}/organizer/{HACK}/settings')
        cf = own.locator('form:has(input[name=confirm])'); await cf.locator('input[name=reason]').fill('Venue unavailable'); await cf.locator('input[name=confirm]').fill('CANCEL')
        await cf.locator('button[type=submit]').click()
        for _ in range(40):
            if q(f"select status from orders where id='{j.get('orderId')}'") == 'refunded': break
            await asyncio.sleep(0.25)
        check('AC8 fest cancellation refunds paid event entries', q(f"select status from orders where id='{j.get('orderId')}'") == 'refunded' and q(f"select status from event_regs where id='{hreg}'") == 'refunded')
        await cx.close()

        # ── AC9 / AC11 event head & judge scope; CSV ──
        bands = q(f"select id from events where fest_id='{NEON}' and title='Battle of Bands'")
        hc = tok['head'][0]; hp = await hc.new_page()
        await hp.goto(f'{B}/organizer/{NEON}/events')
        listed = await hp.locator('[data-event]').evaluate_all('els => els.map(e => e.dataset.event)')
        check('AC9 event head sees only their event on the Events tab', listed == ['Battle of Bands'], listed)
        await hp.goto(f'{B}/organizer/{NEON}/events/{solo}')
        check('AC9 event head opening another event → no-access page', hp.url.endswith('/no-access'), hp.url)
        r = await hc.request.get(f'{B}/organizer/{NEON}/events/{solo}/export')
        check('AC9 event head exporting another event → 404', r.status == 404, r.status)
        r = await hc.request.get(f'{B}/organizer/{NEON}/events/{bands}/export')
        rows = list(csv.DictReader(io.StringIO((await r.text()).lstrip('﻿'))))
        members = int(q(f"select count(*) from event_members where event_id='{bands}' and status = 'joined'"))
        # fix round 1: joined members only; no ₹ column for an event head (no money permission) — tests/events_fix1.py checks the owner's
        check('AC11 CSV: one row per joined member with team, status, email, college, present (no ₹ for the event head)', r.status == 200 and len(rows) == members
              and set(['team', 'entry_status', 'email', 'college', 'present']) <= set(rows[0].keys()) and 'paid_inr' not in rows[0], (r.status, len(rows), members))
        await hp.goto(f'{B}/organizer/{NEON}/events/{bands}')
        price0 = q(f"select price_paise || '|' || slots || '|' || needs_ticket from events where id='{bands}'")
        await hp.evaluate("""() => { const f = document.querySelector('#edit-event form');
            for (const [n, v] of [['fee', 'paid'], ['price', '999'], ['slots', '99']]) { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); } }""")
        await hp.fill('#edit-event input[name=venue]', 'Indie Stage (moved)')
        m = await submit(hp, '#edit-event form')
        check('AC9 event head edits details but can’t change price/slots/needs_ticket', 'saved' in m and q(f"select venue from events where id='{bands}'") == 'Indie Stage (moved)'
              and q(f"select price_paise || '|' || slots || '|' || needs_ticket from events where id='{bands}'") == price0, m)
        # forged edit of another event with the event head's session (owner's page)
        c = await b.new_context(); await c.add_cookies([{'name': 'tf_session', 'value': await token(oc), 'url': B}])
        pg = await c.new_page(); await pg.goto(f'{B}/organizer/{NEON}/events/{solo}'); await pg.fill('#edit-event input[name=venue]', 'FORGED')
        await c.add_cookies([{'name': 'tf_session', 'value': tok['head'][1], 'url': B}])
        try:
            async with pg.expect_response(lambda r: r.request.method == 'POST', timeout=8000): await pg.locator('#edit-event button[type=submit]').click()
        except Exception: pass
        await asyncio.sleep(0.4); await c.close()
        check('AC9 forged edit of event B by event head A → refused, nothing changed', q(f"select venue from events where id='{solo}'") != 'FORGED')
        jc = tok['judge'][0]; jp = await jc.new_page(); await jp.goto(f'{B}/organizer/{NEON}/events/{bands}')
        jbody = await jp.inner_text('#entries')
        check('AC9 judge sees the roster without emails and without export', 'The Neon Riffs' in jbody and '@' not in jbody and await jp.locator('[data-export]').count() == 0)
        r = await jc.request.get(f'{B}/organizer/{NEON}/events/{bands}/export')
        check('AC9 judge export → 404', r.status == 404, r.status)
        # Team tab: link an event head to an event
        await own.goto(f'{B}/organizer/{NEON}/team')
        await own.fill('#add-role input[name=email]', 'ev11@seed.thefest.in'); await own.select_option('#add-role select[name=role]', 'event_head')
        await own.select_option('#add-role select[name=event_id]', label='One Slot Free')
        m = await submit(own, '#add-role form')
        check('AC9 Team tab links an Event head to an event (scope = event name)', q("select scope_label || '|' || (event_id is not null) from fest_roles where email='ev11@seed.thefest.in' and role='event_head'") == 'One Slot Free|true', m)

        # ── AC10 Event counter ──
        sc, sp_ = await login(b, 'eventhead@seed.thefest.in', '/scan/login')
        await sp_.goto(f'{B}/scan?fest={NEON}&counter=event')
        opts = await sp_.locator('select[aria-label=Event] option').evaluate_all('els => els.map(e => e.textContent)')
        check('AC10 event head’s Event counter lists only their event', opts == ['Battle of Bands'], opts)
        mem_code = q(f"select t.code from event_members m join event_regs r on r.id=m.reg_id join tickets t on t.user_id=m.user_id and t.fest_id='{NEON}' and t.status <> 'void' where r.event_id='{bands}' and r.status='confirmed' and m.status='joined' and m.checked_in_at is null order by t.code limit 1")
        async def scan(code, ctx=sc):
            return await post(ctx, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': bands, 'code': code})
        s2c, _ = await login(b, 'organizer@thefest.in', '/scan/login')
        (sa_, ja), (sb_, jb) = await asyncio.gather(scan(mem_code), scan(mem_code, s2c))
        res = sorted([ja.get('result'), jb.get('result')])
        check('AC10 confirmed member → Present; two scanners at once mark once', res == ['admitted', 'duplicate'] and 'Present ✓' in (ja.get('message', '') + jb.get('message', '')) and '/4 here' in (ja.get('message', '') + jb.get('message', '')), (ja, jb))
        _, j = await scan(mem_code)
        check('AC10 rescan → "Already marked at …"', j.get('result') == 'duplicate' and 'Already marked at' in j.get('message', ''), j)
        stand = q(f"select t.code from event_members m join events e on e.id=m.event_id join tickets t on t.user_id=m.user_id and t.fest_id='{NEON}' and t.status<>'void' where e.title='Stand-up Comedy Open' and m.status='joined' and not exists (select 1 from event_members x where x.user_id=m.user_id and x.event_id='{bands}' and x.status='joined') order by t.code limit 1")
        _, j = await scan(stand)
        check('AC10 not registered → says so and lists their events', j.get('result') == 'invalid' and 'Not registered for Battle of Bands' in j.get('message', '') and 'Stand-up Comedy Open' in j.get('message', ''), j)
        vt = q(f"select t.id from tickets t where t.fest_id='{NEON}' and t.status='valid' and t.user_id='{uid('ev12@seed.thefest.in')}' limit 1") or q(f"select t.id from tickets t where t.fest_id='{NEON}' and t.status='valid' order by code desc limit 1")
        q(f"update tickets set status='void' where id='{vt}'")
        _, j = await scan(q(f"select code from tickets where id='{vt}'"))
        q(f"update tickets set status='valid' where id='{vt}'")
        check('AC10 void ticket → refused', j.get('result') == 'void', j)
        _, j = await scan(q(f"select code from tickets where fest_id='{HACK}' limit 1"))
        check('AC10 wrong fest → refused', j.get('result') == 'wrong_fest', j)
        s_, j = await post(sc, '/api/scan', {'festId': NEON, 'counter': 'event', 'eventId': solo, 'code': mem_code})
        check('AC10 event head can’t mark another event (forged eventId)', s_ == 403, (s_, j))
        await sp_.fill('input[aria-label="Ticket code"]', mem_code); await sp_.click('form button:has-text("Check")')
        await sp_.wait_for_selector('.verdict'); v = await sp_.inner_text('.verdict')
        check('AC10 scanner UI shows the verdict', 'Already marked' in v, v)
        await sc.close(); await s2c.close()
        # manual mark present (owner, a member with no scan)
        await own.goto(f'{B}/organizer/{NEON}/events/{bands}')
        before = int(q(f"select count(*) from event_members where event_id='{bands}' and checked_in_at is not null"))
        await own.locator('#entries button:has-text("Mark present")').first.click(); await own.wait_for_timeout(800)
        check('AC10 "Mark present" by hand works', int(q(f"select count(*) from event_members where event_id='{bands}' and checked_in_at is not null")) == before + 1)

        # ── AC1 edit: slots below taken refused; hide; delete with/without entries ──
        await own.goto(f'{B}/organizer/{NEON}/events/{bands}')
        await own.evaluate("document.querySelector('#edit-event input[name=slots]').removeAttribute('min')"); await own.fill('#edit-event input[name=slots]', '0')
        m = await submit(own, '#edit-event form')
        check('AC1 slots can’t go below taken', 'can’t go below' in m or 'Slots' in m, m)
        await own.goto(f'{B}/organizer/{NEON}/events/{solo}'); m = await submit(own, 'form:has(button:has-text("Delete event"))')
        check('AC1 delete refused with entries ("hide it instead")', 'hide it instead' in m and q(f"select count(*) from events where id='{solo}'") == '1', m)
        await own.locator('button:has-text("Hide from students")').click(); await own.wait_for_timeout(600)
        check('AC1 hide works', q(f"select active from events where id='{solo}'") == 'f')
        await own.goto(f'{B}/organizer/{NEON}/events/{robo}'); await own.locator('form:has(button:has-text("Delete event")) button').click(); await own.wait_for_url('**/events?deleted=1')
        check('AC1 delete without entries removes the event and its slot counter', q(f"select count(*) from events where id='{robo}'") == '0' and q("select count(*) from ticket_types where name='Event: Robo Race'") == '0')
        cc = tok['co'][0]; cp = await cc.new_page(); await cp.goto(f'{B}/organizer/{NEON}/events')
        check('AC1 co-organizer can add events too', await cp.locator('#add-event form').count() == 1)

        # ── AC12 activity log ──
        acts = q(f"select string_agg(distinct action, ',') from fest_activity where fest_id='{NEON}' and action like 'event.%'")
        need = ['event.add', 'event.edit', 'event.delete', 'event.hide', 'event.mark_present', 'event.export']
        check('AC12 activity log has the event actions', all(a in acts for a in need), acts)
        check('AC12 actor recorded (event head’s edit and export)', q(f"select count(*) from fest_activity where fest_id='{NEON}' and action in ('event.edit','event.export') and actor_email='eventhead@seed.thefest.in'") >= '2')
        reg9 = q(f"select id from event_regs where event_id='{one}' and status='confirmed'")
        await own.goto(f'{B}/organizer/{NEON}/events/{one}'); m = await submit(own, f'form:has(input[name=regId][value="{reg9}"])')
        check('AC12 + organizer removes a free entry before the deadline (slot freed, logged)', q(f"select status from event_regs where id='{reg9}'") == 'withdrawn' and taken(one) == 0
              and q(f"select count(*) from fest_activity where action='event.entry_remove'") >= '1', m)

        # ── AC13 390px: Events tab, event form, fest cards, event detail, My events, Event counter ──
        bad = []
        for who, url, name in [('organizer@thefest.in', f'/organizer/{NEON}/events', 'tab'), ('organizer@thefest.in', f'/organizer/{NEON}/events/{bands}', 'event'),
                               ('ev1@seed.thefest.in', '/fests/neon-utsav#events', 'fest'), ('ev1@seed.thefest.in', f'/fests/neon-utsav/events/{bands}', 'detail'),
                               ('ev5@seed.thefest.in', '/my-events', 'mine'), ('eventhead@seed.thefest.in', f'/scan?fest={NEON}&counter=event', 'scanner')]:
            c, pg = await login(b, who, '/scan/login' if name == 'scanner' else '/login', MOBILE)
            await pg.goto(B + url); await pg.wait_for_load_state('networkidle')
            await pg.screenshot(path=f'{SHOTS}events-390-{name}.png', full_page=True)
            small = await pg.evaluate("""() => [...document.querySelectorAll('.ev-ui button, .ev-ui a.btn, .ev-ui select, .ev-ui .badge[href], .ev-ui a[data-chip]')]
                .filter(e => e.offsetParent && getComputedStyle(e).display !== 'none').map(e => [e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44)""")
            if not await no_hscroll(pg) or small: bad.append((name, small[:3]))
            await c.close()
        check('AC13 390px: no horizontal scroll, buttons ≥ 44px on every event screen', not bad, bad)
        await b.close()

    # ── AC14 schema v2.8 on a v2.7 database (twice) and the app without v2.8 hides Events ──
    sh('dropdb -h /tmp -U postgres --if-exists thefest_v27 && createdb -h /tmp -U postgres thefest_v27 && pg_dump -h /tmp -U postgres thefest | psql -q -h /tmp -U postgres thefest_v27 >/dev/null 2>&1')
    OLD = 'psql -h /tmp -U postgres thefest_v27'
    q("delete from orders where registration_id is not null; alter table orders drop column registration_id; alter table fest_roles drop constraint fest_roles_event_id_fkey; "
      "drop table event_members, event_regs, events; delete from ticket_types where kind='event'; "
      "alter table ticket_types drop constraint ticket_types_kind_check; alter table ticket_types add constraint ticket_types_kind_check check (kind in ('entry','addon'))", OLD)
    S = Server(3009, 'postgres://postgres@localhost:5432/thefest_v27')
    try:
        try: urllib.request.urlopen(S.base + '/api/health', timeout=20); hs, hb = 200, ''
        except urllib.error.HTTPError as e: hs, hb = e.code, e.read().decode()
        check('AC14 old database: health names the v2.8 tables', hs == 503 and 'events' in hb and 'orders.registration_id' in hb, hb[:200])
        async with async_playwright() as p:
            b = await p.chromium.launch(); c = await b.new_context(); pg = await c.new_page()
            await pg.goto(S.base + '/login'); await pg.fill('input[name=email]', 'organizer@thefest.in'); await pg.fill('input[name=password]', 'password123')
            await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
            r = await pg.goto(f'{S.base}/organizer/{NEON}')
            tabs = await pg.locator('aside.side a.side-link').evaluate_all('els => els.map(e => e.getAttribute("href"))')
            check('AC14 app without v2.8: dashboard works, no Events tab', r.status == 200 and not any(t.endswith('/events') for t in tabs), (r.status, tabs))
            r = await pg.goto(f'{S.base}/fests/neon-utsav')
            check('AC14 app without v2.8: fest page works without Events', r.status == 200 and await pg.locator('#events').count() == 0, r.status)
            await b.close()
    finally:
        S.stop()
    url = 'postgres://postgres@localhost:5432/thefest_v27'
    r1 = sh(f'cd {ROOT} && DATABASE_URL={url} node scripts/db-setup.mjs'); r2 = sh(f'cd {ROOT} && DATABASE_URL={url} node scripts/db-setup.mjs')
    check('AC14 schema v2.8 runs twice cleanly on a v2.7 database', r1.returncode == 0 and r2.returncode == 0
          and q("select count(*) from information_schema.columns where table_name='orders' and column_name='registration_id'", OLD) == '1'
          and 'event' in q("select pg_get_constraintdef(oid) from pg_constraint where conname='ticket_types_kind_check'", OLD), (r1.stderr[-300:], r2.stderr[-300:]))
    sh('dropdb -h /tmp -U postgres --if-exists thefest_v27')

    failed = [n for n, ok in results if not ok]
    print(f'\nevents: {len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())

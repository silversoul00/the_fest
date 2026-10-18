# Two-way sponsorship requests (2026-10-18). Main server on :3000 (seeded DB) plus an old-database server on :3008.
# Covers the acceptance criteria in docs/team/research/2026-10-18-sponsorship-requests.md (numbers in the check names).
import asyncio, os, signal, subprocess, sys, time, urllib.request, urllib.error
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E2E = os.environ.get('E2E_DIR', '/tmp/thefest-e2e')
B = os.environ.get('E2E_BASE', 'http://localhost:3000')
DB = os.environ.get('E2E_PSQL', 'psql -h /tmp -U postgres thefest')
MOBILE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra != '' else ''))
def q(sql, db=DB): return subprocess.run(db + ' -qtAc "' + sql + '"', shell=True, capture_output=True, text=True).stdout.strip()
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True)

async def login(b, email, base=B):
    ctx = await b.new_context(**MOBILE); pg = await ctx.new_page()
    await pg.goto(base + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    return pg

async def text(pg, sel='body'): return await pg.locator(sel).first.inner_text()
async def html(pg, path): return await (await pg.request.get(B + path)).text()
async def no_sideways(pg): return await pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')
async def min_height(pg, sel):
    hs = [(await l.bounding_box() or {}).get('height', 0) for l in await pg.locator(sel).all() if await l.is_visible()]
    return min(hs) if hs else 0
async def alert(pg, want=None):
    """Waits for a form message (containing `want`, if given). Not Next's empty route announcer."""
    loc = pg.locator('.alert[role=alert], .alert[role=status]', **({'has_text': want} if want else {}))
    try: await loc.first.wait_for(timeout=8000)
    except Exception: return False if want else ''
    return True if want else ' '.join(await loc.all_inner_texts())

async def badge(pg, rid, label):
    """After accept/decline/withdraw the card re-renders with its new status chip."""
    try: await pg.locator(f'[data-request="{rid}"] .badge', has_text=label).first.wait_for(timeout=8000); return True
    except Exception: return False

async def capture_action(pg, click):
    """Click a server-action button but stop the POST; returns it so it can be replayed as someone else."""
    box = {}
    async def handler(route):
        r = route.request
        if r.method == 'POST' and 'next-action' in r.headers and not box:
            box.update(url=r.url, headers={k: v for k, v in r.headers.items() if k in ('next-action', 'content-type', 'accept', 'next-router-state-tree')},
                       body=r.post_data_buffer)
            await route.abort()
        else:
            await route.continue_()
    await pg.route('**/*', handler)
    await click()
    for _ in range(80):
        if box: break
        await pg.wait_for_timeout(100)
    await pg.unroute('**/*')
    return box

async def replay(ctx_req, act):
    r = await ctx_req.post(act['url'], headers={**act['headers'], 'origin': B}, data=act['body'], max_redirects=0)
    return await r.text()

def emails(to, like): return q(f"select count(*) from email_outbox where to_email='{to}' and subject like '%{like}%'")
def email_bodies(to): return q(f"select coalesce(string_agg(body_text, ' '),'') from email_outbox where to_email='{to}'")

class Server:  # an extra server against another database (same pattern as tests/sponsor_leads.py)
    def __init__(self, port, db_url):
        self.base = f'http://localhost:{port}'
        e = os.environ.copy(); e.update(DATABASE_URL=db_url, PORT=str(port), DEMO_PAYMENTS='', E2E_ERROR_ROUTE='', ADMIN_EMAILS='')
        self.log = open(f'{E2E}/server-{port}.log', 'a')
        self.p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', str(port)], cwd=ROOT, env=e,
                                  stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
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
    fid = lambda slug: q(f"select id from fests where slug='{slug}'")
    neon, hack, kalaa, comm, goal, beats = map(fid, ['neon-utsav', 'hackverse', 'kalaa-fest', 'commerce-carnival', 'goal-rush', 'campus-beats'])
    mk = lambda em, nm, role, ver: q(f"insert into users (email, password_hash, name, role, email_verified_at) select '{em}', password_hash, '{nm}', '{role}', {ver} from users where email='sponsor@thefest.in' on conflict (email) do nothing")
    mk('newbrand@seed.thefest.in', 'Nina Nova', 'sponsor', 'now()'); mk('unver@seed.thefest.in', 'Umesh Unverified', 'sponsor', 'null')
    mk('coorg@seed.thefest.in', 'Cora Coorganizer', 'organizer', 'now()')
    q(f"insert into fest_members (fest_id, email) values ('{neon}', 'coorg@seed.thefest.in') on conflict do nothing")
    nb = q("select id from users where email='newbrand@seed.thefest.in'"); unv = q("select id from users where email='unver@seed.thefest.in'")
    volt = q("select id from users where email='sponsor@thefest.in'"); chai = q("select id from users where email='brand@seed.thefest.in'")
    # throwaway fests (run by Kalaa's organizer, so Neon's "last fest" stays Goal Rush) that must never be shown to brands even though they are "open to sponsors"
    for slug, status, s, e in [('sr-draft', 'draft', 5, 6), ('sr-cancel', 'cancelled', 5, 6), ('sr-past', 'live', -5, -1)]:
        q(f"insert into fests (slug, organizer_id, name, college, city, category, starts_on, ends_on, status, open_to_sponsors) select '{slug}', organizer_id, 'Hidden {slug}', college, city, category, current_date + {s}, current_date + {e}, '{status}', true from fests where id='{kalaa}'")
    hidden = {slug: fid(slug) for slug in ['sr-draft', 'sr-cancel', 'sr-past']}
    q(f"update fests set open_to_sponsors = true where id in ('{goal}', '{beats}')")
    # earlier suites may have cancelled Commerce Carnival (its open request to Volt Energy is used below): run it live
    comm_old = q(f"select status||'|'||starts_on||'|'||ends_on from fests where id='{comm}'").split('|')
    q(f"update fests set status='live', starts_on=current_date+34, ends_on=current_date+35 where id='{comm}'")
    tiny = q(f"select u.id from tickets t join users u on u.id=t.user_id where t.fest_id='{neon}' and t.status<>'void' and u.email like 'attendee%' order by u.email desc limit 1")
    tiny_old = q(f"select coalesce(college,'') from users where id='{tiny}'")
    q(f"update users set college='Tiny SR College' where id='{tiny}'")
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            errs = []
            org = await login(b, 'organizer@thefest.in'); org.on('pageerror', lambda e: errs.append(str(e)))
            sp = await login(b, 'sponsor@thefest.in'); sp.on('pageerror', lambda e: errs.append(str(e)))
            nw = await login(b, 'newbrand@seed.thefest.in'); nw.on('pageerror', lambda e: errs.append(str(e)))

            # 2. who brands can find
            await sp.goto(f'{B}/sponsor/fests'); t = await text(sp, 'main')
            check('2. Find fests lists live, opted-in fests (Neon Utsav, Kalaa)', 'Neon Utsav' in t and 'Kalaa' in t, t[:200])
            check('2. draft, review, cancelled, ended and opted-out fests never appear',
                  not any(n in t for n in ['Hidden sr-', 'Campus Beats', 'Goal Rush', 'Hackverse', 'Commerce Carnival']), t[:300])
            codes = {}
            for name, f in [('draft', hidden['sr-draft']), ('cancelled', hidden['sr-cancel']), ('ended', hidden['sr-past']), ('review', beats), ('ended (status)', goal), ('opted out', hack)]:
                codes[name] = (await sp.goto(f'{B}/sponsor/fests/{f}')).status
            check('2. direct media-kit URL of hidden fests → 404', all(c == 404 for c in codes.values()), codes)
            await sp.goto(f'{B}/sponsor/fests?city=Mysuru'); t = await text(sp, 'main')
            check('2. city filter works', 'Kalaa' in t and 'Neon Utsav' not in t)
            check('12. Find fests at 390px: no sideways scroll, buttons ≥44px', await no_sideways(sp) and await min_height(sp, 'main .btn, main .chip') >= 44)

            # 3. media kit numbers, no personal data, small colleges folded
            await sp.goto(f'{B}/sponsor/fests/{neon}'); t = await text(sp, 'main'); h = await sp.content()
            tickets = q(f"select count(*) from tickets where fest_id='{neon}' and status<>'void'")
            share = q(f"select round(100*avg((lower(coalesce(u.college,''))=lower(f.college))::int))::int from tickets t join users u on u.id=t.user_id join fests f on f.id=t.fest_id where t.fest_id='{neon}' and t.status<>'void'")
            fig = lambda label: sp.locator('.stat', has_text=label).locator('.v').first.inner_text()
            check('3. tickets sold matches festAnalytics', (await fig('Tickets sold')).replace(',', '') == tickets, tickets)
            check('3. host-college share matches festAnalytics', await fig('Host college') == f'{share}%', share)
            check('3. "Verified by THE FEST ticketing" label and last-fest line', 'verified by the fest ticketing' in t.lower() and 'Last fest: Goal Rush' in t, t[:300])
            names = q(f"select string_agg(distinct u.name, '|') from tickets t join users u on u.id=t.user_id where t.fest_id='{neon}'").split('|')
            check('3. no student name or email in the media kit HTML', not any(n and n in h for n in names) and '@seed.thefest.in' not in h and '@thefest.in' not in h)
            check('3. a college with fewer than 5 attendees is folded into "Other"', 'Tiny SR College' not in h and 'Other' in await text(sp, '.kit-colleges'))
            check('12. media kit at 390px: no sideways scroll, buttons ≥44px', await no_sideways(sp) and await min_height(sp, 'main .btn') >= 44)

            # 1. no profile → sent to /sponsor/profile; unverified can browse but not send
            await nw.goto(f'{B}/sponsor/fests/{neon}')
            await nw.click('a:has-text("Set up your brand profile first")'); await nw.wait_for_url('**/sponsor/profile**')
            check('1. a brand without a profile is sent to /sponsor/profile', '/sponsor/profile' in nw.url and 'Set up your brand profile first' in await text(nw, 'main'))
            uv = await login(b, 'unver@seed.thefest.in')
            r = await uv.goto(f'{B}/sponsor/fests/{neon}')
            check('1. unverified brand can browse the media kit but gets no send form', r.status == 200 and await uv.locator('#request textarea').count() == 0)

            # profile + listing (10)
            await nw.fill('input[name=brand]', 'Nova Snacks'); await nw.select_option('select[name=category]', 'food')
            await nw.fill('input[name=budget_min]', '20000'); await nw.fill('input[name=budget_max]', '300000'); await nw.fill('input[name=cities]', 'Bengaluru, Mysuru')
            await nw.check('input[name=listed]'); await nw.click('button:has-text("Save profile")')
            check('10. brand profile saved and listed', await alert(nw, 'Organizers can now find your brand') and q(f"select listed from brand_profiles where user_id='{nb}'") == 't')
            check('12. profile page at 390px: no sideways scroll, buttons ≥44px', await no_sideways(nw) and await min_height(nw, 'main .btn') >= 44)

            # 4/7. brand → fest request, exact paise
            await nw.goto(f'{B}/sponsor/fests/{neon}')
            await nw.select_option('select[name=tier]', 'Title'); await nw.fill('input[name=amount]', '12345.50')
            await nw.fill('textarea[name=deliverables]', 'Two stalls'); await nw.fill('textarea[name=message]', 'Hello Neon!')
            await nw.click('button:has-text("Send request")')
            check('4. brand request sent', await alert(nw, 'Request sent'))
            rq = q(f"select id from sponsor_requests where fest_id='{neon}' and brand_user_id='{nb}' and status='sent'")
            check('7. amount stored exactly in paise (₹12,345.50 → 1234550)', q(f"select amount_paise from sponsor_requests where id='{rq}'") == '1234550')
            await nw.wait_for_timeout(800)
            check('4. owner and co-organizer emailed', emails('organizer@thefest.in', 'Nova Snacks wants to sponsor') == '1' and emails('coorg@seed.thefest.in', 'Nova Snacks wants to sponsor') == '1')
            check('9. new-request email has no brand contact', 'newbrand@' not in email_bodies('organizer@thefest.in'))
            # 5. duplicate open pair
            await nw.goto(f'{B}/sponsor/fests/{neon}'); await nw.fill('input[name=amount]', '1000'); await nw.click('button:has-text("Send request")')
            check('5. a second open request for the same pair is refused', await alert(nw, 'already an open request'))

            await org.goto(f'{B}/organizer/{neon}/sponsors'); t = await text(org, 'body')
            card = org.locator(f'[data-request="{rq}"]')
            check('4. the request is in the organizer\'s Received list', 'Requests received' in t and await card.count() == 1)
            check('6. receiver sees Accept and Decline, not Withdraw', await card.locator('button:has-text("Accept")').count() == 1
                  and await card.locator('summary:has-text("Decline")').count() == 1 and await card.locator('button:has-text("Withdraw")').count() == 0)
            check('4. Sponsors tab shows the open-request count', 'Sponsors (1)' in t or await org.locator('.tab-count').count() > 0, t[:120])
            check('9. before accept the organizer page has no brand email', 'newbrand@' not in await html(org, f'/organizer/{neon}/sponsors'))
            await nw.goto(f'{B}/sponsor/requests')
            ncard = nw.locator(f'[data-request="{rq}"]')
            check('6. sender sees Withdraw, not Accept', await ncard.locator('button:has-text("Withdraw")').count() == 1 and await ncard.locator('button:has-text("Accept")').count() == 0)
            check('9. before accept the brand page has no organizer email', 'organizer@thefest.in' not in await html(nw, '/sponsor/requests'))
            check('12. requests page at 390px: no sideways scroll, buttons ≥44px', await no_sideways(nw) and await min_height(nw, 'main .btn') >= 44)

            # 10. unlisting removes from the directory at once; the open request stays
            await org.goto(f'{B}/organizer/{neon}/sponsors')
            check('10. listed brand appears in Find brands', await org.locator('.brand-card', has_text='Nova Snacks').count() == 1)
            await nw.goto(f'{B}/sponsor/profile'); await nw.uncheck('input[name=listed]'); await nw.click('button:has-text("Save profile")'); await alert(nw, 'not listed')
            await org.goto(f'{B}/organizer/{neon}/sponsors')
            check('10. unticking "listed" removes the brand at once; the open request stays',
                  await org.locator('.brand-card', has_text='Nova Snacks').count() == 0 and await org.locator(f'[data-request="{rq}"]').count() == 1)
            await nw.goto(f'{B}/sponsor/profile'); await nw.check('input[name=listed]'); await nw.click('button:has-text("Save profile")'); await alert(nw, 'Organizers can now find')

            # 6. the accept action replayed as other people is refused server-side
            await org.goto(f'{B}/organizer/{neon}/sponsors')
            act = await capture_action(org, lambda: org.locator(f'[data-request="{rq}"] button:has-text("Accept")').click())
            check('6. captured the Accept action', bool(act))
            stu = await login(b, 'student@thefest.in'); vol = await login(b, 'volunteer@thefest.in'); org2 = await login(b, 'organizer2@thefest.in')
            anon = await b.new_context()
            for who, req in [('student', stu.request), ('volunteer (gate staff)', vol.request), ('another fest\'s organizer', org2.request), ('logged-out', anon.request), ('the sending brand', nw.request)]:
                try: await replay(req, act)
                except Exception: pass
                check(f'6/11. accept posted as {who} is refused', q(f"select status from sponsor_requests where id='{rq}'") == 'sent'
                      and q(f"select count(*) from sponsors where email='newbrand@seed.thefest.in'") == '0')
            r = await stu.goto(f'{B}/sponsor/requests'); check('6. a student is turned away from /sponsor/requests', '/sponsor' not in stu.url)
            r = await vol.goto(f'{B}/organizer/{neon}/sponsors'); check('11. a volunteer can\'t open the organizer sponsors tab', f'/organizer/{neon}' not in vol.url)

            # 8. double-click: two accepts at once → one sponsors row, the other "already answered"
            outs = await asyncio.gather(replay(org.request, act), replay(org.request, act))
            check('8. two accepts at once give exactly one sponsors row', q(f"select count(*) from sponsors where email='newbrand@seed.thefest.in' and fest_id='{neon}'") == '1')
            check('8. the second accept says "already answered"', sum('already answered' in o for o in outs) == 1 and sum('Accepted — the sponsor is added' in o for o in outs) == 1, [o[-200:] for o in outs])
            sid, brand, tier, amt, code = q(f"select id, brand, tier, amount_paise, booth_code from sponsors where email='newbrand@seed.thefest.in'").split('|')
            check('7. sponsors row has the request\'s brand, tier, exact amount and a booth code', (brand, tier, amt) == ('Nova Snacks', 'Title', '1234550') and len(code) >= 6)
            check('7. request is linked to the sponsor', q(f"select sponsor_id from sponsor_requests where id='{rq}'") == sid)
            await nw.goto(f'{B}/sponsor'); check('7. the fest shows on the brand\'s /sponsor dashboard', 'Neon Utsav' in await text(nw, 'main'))
            r1 = await nw.goto(f'{B}/sponsor/{sid}'); r2 = await nw.goto(f'{B}/sponsor/{sid}/report')
            check('7. sponsor page and report work for the new sponsor', r1.status == 200 and r2.status == 200)
            await nw.wait_for_timeout(800)
            check('9. after accept both sides see contacts (pages)', 'organizer@thefest.in' in await html(nw, '/sponsor/requests') and 'newbrand@seed.thefest.in' in await html(org, f'/organizer/{neon}/sponsors'))
            check('9. after accept both sides are emailed with the other\'s contact',
                  emails('newbrand@seed.thefest.in', 'sponsorship confirmed') == '1' and 'organizer@thefest.in' in email_bodies('newbrand@seed.thefest.in')
                  and 'newbrand@seed.thefest.in' in q("select body_text from email_outbox where to_email='organizer@thefest.in' and subject like '%confirmed%' order by id desc limit 1"))

            # 11. co-organizer accepts; an existing sponsor row is re-used, never duplicated
            co = await login(b, 'coorg@seed.thefest.in')
            await sp.goto(f'{B}/sponsor/fests/{neon}'); await sp.fill('input[name=amount]', '200000'); await sp.click('button:has-text("Send request")'); await alert(sp, 'Request sent')
            vr = q(f"select id from sponsor_requests where fest_id='{neon}' and brand_user_id='{volt}' and status='sent'")
            await co.goto(f'{B}/organizer/{neon}/sponsors')
            await co.locator(f'[data-request="{vr}"] button:has-text("Accept")').click()
            check('11. co-organizer can accept', await badge(co, vr, 'Accepted') and q(f"select status from sponsor_requests where id='{vr}'") == 'accepted')
            check('7. accepting for a brand already added re-uses its sponsors row (no duplicate)',
                  q(f"select count(*) from sponsors where fest_id='{neon}' and email='sponsor@thefest.in'") == '1'
                  and q(f"select sponsor_id = (select id from sponsors where fest_id='{neon}' and email='sponsor@thefest.in') from sponsor_requests where id='{vr}'") == 't')
            await co.goto(f'{B}/organizer/{neon}/sponsors?to={chai}')
            await co.fill('#send input[name=amount]', '15000'); await co.click('#send button:has-text("Send request")')
            check('11. co-organizer can send a request', await alert(co, 'Request sent to Chai Point Express'))

            # 4. fest → brand request; 5. fest daily cap; decline + 7-day cool-down
            for i in range(20):
                q(f"insert into sponsor_requests (fest_id, brand_user_id, direction, brand, tier, amount_paise, status) values ('{hack}', '{chai}', 'org_to_brand', 'X', 'Partner', 0, 'withdrawn')")
            await org.goto(f'{B}/organizer/{hack}/sponsors?to={nb}'); await org.fill('#send input[name=amount]', '50000'); await org.click('#send button:has-text("Send request")')
            check('5. the 21st fest request in 24h is refused', await alert(org, 'up to 20 requests a day'))
            q(f"delete from sponsor_requests where fest_id='{hack}' and brand='X'")
            await org.goto(f'{B}/organizer/{hack}/sponsors?to={nb}'); await org.fill('#send input[name=amount]', '50000'); await org.click('#send button:has-text("Send request")')
            check('4. organizer request sent', await alert(org, 'Request sent to Nova Snacks'))
            hr = q(f"select id from sponsor_requests where fest_id='{hack}' and brand_user_id='{nb}' and status='sent'")
            await nw.wait_for_timeout(800)
            check('4. the brand is emailed', emails('newbrand@seed.thefest.in', 'invites Nova Snacks') == '1')
            await nw.goto(f'{B}/sponsor/requests')
            check('4. organizer request in the brand\'s Received list', await nw.locator(f'section[aria-label=Received] [data-request="{hr}"]').count() == 1)
            check('4. brand Requests link shows the open count', await nw.locator('.req-count').count() == 1)
            await nw.locator(f'[data-request="{hr}"] summary').click()
            await nw.fill(f'[data-request="{hr}"] input[name=reply]', 'Not this time'); await nw.click(f'[data-request="{hr}"] button:has-text("Decline request")')
            check('decline with a note', await badge(nw, hr, 'Declined') and q(f"select status||'|'||reply from sponsor_requests where id='{hr}'") == 'declined|Not this time')
            await nw.wait_for_timeout(800)
            check('decline emails the sender with the note', 'Not this time' in q("select body_text from email_outbox where to_email='organizer@thefest.in' and subject like '%declined%' order by id desc limit 1"))
            await org.goto(f'{B}/organizer/{hack}/sponsors?to={nb}'); await org.fill('#send input[name=amount]', '50000'); await org.click('#send button:has-text("Send request")')
            check('5. re-sending within 7 days of a decline is refused', await alert(org, 'declined in the last 7 days'))
            check('12. organizer sponsors tab at 390px: no sideways scroll, request/brand buttons ≥44px',
                  await no_sideways(org) and await min_height(org, '.req-card .btn, .brand-card .btn, #send .btn') >= 44)

            # 5. brand daily cap; withdraw (sender only, no email)
            await sp.goto(f'{B}/sponsor/requests')
            kr = q(f"select id from sponsor_requests where fest_id='{kalaa}' and brand_user_id='{volt}' and status='sent'")
            n_mail = q("select count(*) from email_outbox")
            await sp.click(f'[data-request="{kr}"] button:has-text("Withdraw")')
            check('withdraw by the sender', await badge(sp, kr, 'Withdrawn') and q(f"select status from sponsor_requests where id='{kr}'") == 'withdrawn')
            await sp.wait_for_timeout(600); check('no email on withdraw', q("select count(*) from email_outbox") == n_mail)
            used = int(q(f"select count(*) from sponsor_requests where brand_user_id='{volt}' and direction='brand_to_org' and created_at > now() - interval '24 hours'"))
            for i in range(10 - used):
                q(f"insert into sponsor_requests (fest_id, brand_user_id, direction, brand, tier, amount_paise, status) values ('{goal}', '{volt}', 'brand_to_org', 'X', 'Partner', 0, 'withdrawn')")
            await sp.goto(f'{B}/sponsor/fests/{kalaa}'); await sp.fill('input[name=amount]', '1000'); await sp.click('button:has-text("Send request")')
            check('5. the 11th brand request in 24h is refused', await alert(sp, 'up to 10 requests a day'))
            q(f"delete from sponsor_requests where brand='X'")

            # 6. wrong side via a tampered form; 8. accepting after the fest is cancelled / ended
            cr = q(f"select id from sponsor_requests where fest_id='{comm}' and brand_user_id='{volt}' and status='sent'")
            await sp.goto(f'{B}/sponsor/requests')
            # the brand's own sent (now withdrawn) request can't be accepted by the brand: point the Accept form at it
            await sp.evaluate('([a, b]) => document.querySelector(`[data-request="${a}"] input[name=id]`).value = b', [cr, vr])
            await sp.click(f'[data-request="{cr}"] button:has-text("Accept")')
            check('6. the sender can\'t accept its own request (server-side)', await alert(sp, 'Only the side that received'))
            await sp.goto(f'{B}/sponsor/requests')
            act2 = await capture_action(sp, lambda: sp.locator(f'[data-request="{cr}"] button:has-text("Accept")').click())
            q(f"update fests set status='cancelled' where id='{comm}'")
            out = await replay(sp.request, act2)
            check('8. accepting after the fest is cancelled is refused', 'ended or was cancelled' in out and q(f"select status from sponsor_requests where id='{cr}'") == 'sent')
            await sp.goto(f'{B}/sponsor/requests')
            check('8. the request reads "Expired" with no Accept', await sp.locator(f'[data-request="{cr}"]', has_text='Expired').count() == 1
                  and await sp.locator(f'[data-request="{cr}"] button:has-text("Accept")').count() == 0)
            q(f"update fests set status='live', starts_on=current_date-3, ends_on=current_date-1 where id='{comm}'")
            out = await replay(sp.request, act2)
            check('8. accepting after the fest has ended is refused', 'ended or was cancelled' in out and q(f"select status from sponsor_requests where id='{cr}'") == 'sent')
            q(f"update fests set starts_on=current_date+34, ends_on=current_date+35 where id='{comm}'")  # live again for the next check
            await sp.goto(f'{B}/sponsor/requests')
            await sp.evaluate('(a) => document.querySelector(`[data-request="${a}"] input[name=do]`).value = "withdraw"', cr)
            await sp.click(f'[data-request="{cr}"] button:has-text("Accept")')
            check('6. the receiver can\'t withdraw (server-side)', await alert(sp, 'Only the side that sent'))

            errs = [e for e in errs if 'fetch' not in e.lower()]  # the deliberately stopped POSTs in capture_action
            check('no page errors', not errs, errs[:3])
            await b.close()

        # 13. old database without v2.6: pages load and say "not set up yet"
        sh('dropdb -h /tmp -U postgres --if-exists thefest_v25 && createdb -h /tmp -U postgres thefest_v25 && '
           'pg_dump -h /tmp -U postgres thefest | psql -q -h /tmp -U postgres thefest_v25 >/dev/null 2>&1')
        OLD = 'psql -h /tmp -U postgres thefest_v25'
        q('drop table sponsor_requests; drop table brand_profiles; alter table fests drop column open_to_sponsors', OLD)
        S = Server(3008, 'postgres://postgres@localhost:5432/thefest_v25')
        try:
            try: urllib.request.urlopen(S.base + '/api/health', timeout=20); hs, hb = 200, ''
            except urllib.error.HTTPError as e: hs, hb = e.code, e.read().decode()
            check('13. old database: health names the v2.6 tables and column', hs == 503 and all(n in hb for n in ['brand_profiles', 'sponsor_requests', 'fests.open_to_sponsors']), hb[:200])
            async with async_playwright() as p:
                b = await p.chromium.launch()
                s2 = await login(b, 'sponsor@thefest.in', S.base)
                for path in ['/sponsor', '/sponsor/requests', '/sponsor/fests', '/sponsor/profile']:
                    r = await s2.goto(S.base + path)
                    ok = r.status == 200 and (path == '/sponsor' or 'not set up yet' in await text(s2, 'main'))
                    check(f'13. old database: {path} loads' + ('' if path == '/sponsor' else ' and says "not set up yet"'), ok, r.status)
                o2 = await login(b, 'organizer@thefest.in', S.base)
                r = await o2.goto(f'{S.base}/organizer/{neon}/sponsors')
                check('13. old database: organizer sponsors tab loads and says "not set up yet"', r.status == 200 and 'not set up yet' in await text(o2), r.status)
                await b.close()
        finally:
            S.stop(); sh('dropdb -h /tmp -U postgres --if-exists thefest_v25')
    finally:
        q(f"update users set college={'NULL' if not tiny_old else chr(39) + tiny_old + chr(39)} where id='{tiny}'")
        q("delete from fests where slug like 'sr-%'")
        q(f"update fests set open_to_sponsors = false where id in ('{goal}', '{beats}')")
        q(f"update fests set status='{comm_old[0]}', starts_on='{comm_old[1]}', ends_on='{comm_old[2]}' where id='{comm}'")
        q("delete from sponsor_requests where brand='X'")

    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} sponsorship-request checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

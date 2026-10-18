# Sponsor leads + ROI report (2026-10-18). Main server on :3000 (seeded DB) plus an old-database server on :3007.
# Covers the acceptance criteria in docs/team/research/2026-10-18-sponsor-leads.md (numbers in the check names).
import asyncio, json, os, re, signal, subprocess, sys, time, urllib.request, urllib.error
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
def inr(paise):  # same as rupees() in src/lib/format.ts
    return subprocess.run(['node', '-e', f'const r={paise}/100;console.log("₹"+r.toLocaleString("en-IN",{{maximumFractionDigits:r%1?2:0}}))'], capture_output=True, text=True).stdout.strip()
def hour_label(h): return f"{h % 12 or 12}{' AM' if h < 12 else ' PM'}"

async def login(b, email, base=B):
    pg = await (await b.new_context(**MOBILE)).new_page()
    await pg.goto(base + '/login'); await pg.fill('input[name=email]', email); await pg.fill('input[name=password]', 'password123')
    await pg.click('button[type=submit]'); await pg.wait_for_load_state('networkidle')
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    return pg

async def no_sideways(pg):
    return await pg.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')

async def min_height(pg, sel):
    hs = [(await l.bounding_box() or {}).get('height', 0) for l in await pg.locator(sel).all() if await l.is_visible()]
    return min(hs) if hs else 0

async def forge_share(pg, html, adult, course=''):
    """Submit a copy of the real share form without JavaScript (a plain POST), with or without the 18+ tick."""
    await pg.evaluate('''([html, adult, course]) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d);
        const f = d.querySelector('form'); const a = f.querySelector('[name=adult]'); a.checked = adult; f.querySelector('[name=course_year]').value = course;
        f.querySelector('button').disabled = false; f.submit(); }''', [html, adult, course])
    await pg.wait_for_load_state('networkidle'); await pg.wait_for_timeout(300)

async def text(pg, sel='main'): return await pg.locator(sel).first.inner_text()

class Server:  # an extra server against another database (same pattern as tests/fixes1.py)
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
    neon = q("select id from fests where slug='neon-utsav'")
    s1, code, amount = q("select id, booth_code, amount_paise from sponsors where fest_id='%s' and brand='Volt Energy'" % neon).split('|')
    s2 = q("select s.id from sponsors s join fests f on f.id=s.fest_id where f.slug='hackverse' and s.brand='Volt Energy'")
    stu = q("select id from users where email='student@thefest.in'")
    q(f"delete from sponsor_leads where user_id='{stu}'; delete from sponsor_visits where user_id='{stu}' and sponsor_id='{s1}'")
    q(f"update users set phone='9876500000' where id='{stu}'")
    q("insert into users (email, password_hash, name, role, email_verified_at) select 'othersponsor@seed.thefest.in', password_hash, 'Other Brand', 'sponsor', now() from users where email='sponsor@thefest.in' on conflict (email) do nothing")
    # one checked-in attendee from a tiny college (must never be named to sponsors)
    tiny_uid, tiny_old = q(f"select u.id, coalesce(u.college,'') from tickets t join users u on u.id=t.user_id where t.fest_id='{neon}' and t.status='used' and u.email like 'attendee%' order by u.email limit 1").split('|')
    q(f"update users set college='Tiny Test College' where id='{tiny_uid}'")
    lead = lambda: q(f"select coalesce(name,'')||'|'||coalesce(phone,'')||'|'||coalesce(course_year,'')||'|'||shared_at||'|'||coalesce(withdrawn_at::text,'') from sponsor_leads where sponsor_id='{s1}' and user_id='{stu}'")
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            errs = []
            st = await login(b, 'student@thefest.in'); st.on('pageerror', lambda e: errs.append(str(e)))

            # 1. check in without sharing, still one tap
            await st.goto(f'{B}/booth/{code}')
            check('1. booth: share card hidden before check-in', await st.locator('text=Want Volt Energy to contact you?').count() == 0)
            await st.click('button:has-text("Check in at")'); await st.wait_for_url('**done=1')
            check('1. one tap checks in without sharing', q(f"select count(*) from sponsor_visits where sponsor_id='{s1}' and user_id='{stu}'") == '1'
                  and q(f"select count(*) from sponsor_leads where user_id='{stu}'") == '0')
            check('1. after check-in the optional share card shows the itemised notice',
                  (lambda body: all(t in body for t in ['Want Volt Energy to contact you?', 'Volt Energy will get: your name, email, college', 'Data Protection Board of India']))(await text(st)))
            # the share form exactly as the server sends it (before React hydrates it), for plain no-JS POSTs below
            h = await (await st.request.get(f'{B}/booth/{code}')).text(); i = h.find('name="adult"')
            share_html = h[h.rfind('<form', 0, i):h.find('</form>', i) + 7]

            # 2. 18+ tick required (browser + server)
            btn = st.locator('button:has-text("Share my contact with")')
            check('2. share button disabled until "I am 18 or older" is ticked', await btn.is_disabled())
            phone_box = st.locator('input[name=phone]')
            check('3. "Also share my phone" is unticked by default', await phone_box.count() == 1 and not await phone_box.is_checked())
            await forge_share(st, share_html, adult=False)
            check('2. forged POST without the 18+ tick is rejected, no row', 'err=adult' in st.url and q(f"select count(*) from sponsor_leads where user_id='{stu}'") == '0', st.url)
            check('2. rejection explains why', 'I am 18 or older' in await text(st, '[role=alert]'))
            # 15. 390px booth page
            check('15. booth page at 390px: no sideways scroll, buttons ≥44px', await no_sideways(st) and await min_height(st, 'main .btn') >= 44)

            await st.fill('input[name=course_year]', '=HYPERLINK("x")')
            await st.check('input[name=adult]'); await btn.click(); await st.wait_for_url('**shared=1')
            row = lead().split('|')
            check('4. after sharing the booth page shows the shared state', await st.locator('text=Shared with Volt Energy on').count() == 1)
            check('3. phone left unticked → not stored', row[1] == '', row)
            first_shared = row[3]
            await forge_share(st, share_html, adult=True, course='=HYPERLINK("x")')
            check('4. sharing twice keeps one row (and the first time)', q(f"select count(*) from sponsor_leads where sponsor_id='{s1}' and user_id='{stu}'") == '1' and lead().split('|')[3] == first_shared)

            # sponsor sees it
            sp = await login(b, 'sponsor@thefest.in'); sp.on('pageerror', lambda e: errs.append(str(e)))
            await sp.goto(f'{B}/sponsor/{s1}')
            leads_card = sp.locator('section[aria-label=Leads]')
            check('sponsor: lead appears in the Leads card (name, course; no email/phone on screen)',
                  'Arjun Sharma' in await leads_card.inner_text() and 'student@thefest.in' not in await leads_card.inner_text())
            n_active = q(f"select count(*) from sponsor_leads where sponsor_id='{s1}' and withdrawn_at is null")
            check('sponsor: Leads stat matches the database', (await sp.locator('.stat', has_text='Leads').locator('.v').first.inner_text()).replace(',', '') == n_active, n_active)
            r = await sp.request.get(f'{B}/sponsor/{s1}/leads.csv'); raw = await r.body(); csv = raw.decode('utf-8')
            mine = next((l for l in csv.split('\r\n') if 'student@thefest.in' in l), '')
            check('9. CSV has a BOM and the columns', raw.startswith(b'\xef\xbb\xbf') and csv.lstrip('﻿').startswith('status,name,email,phone,college,course_year,shared_at_ist'), csv[:120])
            check('9. formula cells neutralised (=HYPERLINK → \'=HYPERLINK)', '"\'=HYPERLINK(""x"")"' in mine, mine)
            check('3. CSV phone cell empty when not ticked (account has a phone)', mine.startswith('"active","Arjun Sharma","student@thefest.in",""'), mine)
            check('15. leads card at 390px: no sideways scroll, download button ≥44px', await no_sideways(sp) and await min_height(sp, 'a:has-text("Download leads")') >= 44)

            # 5. stop sharing from the booth page
            await st.goto(f'{B}/booth/{code}')
            await st.click('button:has-text("Stop sharing")'); await st.wait_for_url('**stopped=1')
            row = lead().split('|')
            check('5. stop sharing from the booth: withdrawn, details cleared, email kept', row[4] != '' and row[0] == '' and row[2] == '' and
                  q(f"select email from sponsor_leads where sponsor_id='{s1}' and user_id='{stu}'") == 'student@thefest.in', row)
            await sp.goto(f'{B}/sponsor/{s1}')
            check('5. gone from the sponsor\'s active list and Leads count', 'Arjun Sharma' not in await leads_card.inner_text() and
                  (await sp.locator('.stat', has_text='Leads').locator('.v').first.inner_text()).replace(',', '') == str(int(n_active) - 1))
            check('5. email shows in the sponsor\'s Withdrawn list', 'student@thefest.in' in await sp.locator('section[aria-label=Withdrawn]').inner_text())
            csv = (await (await sp.request.get(f'{B}/sponsor/{s1}/leads.csv')).body()).decode('utf-8')
            mine = next((l for l in csv.split('\r\n') if 'student@thefest.in' in l), '')
            check('5. CSV: only as "withdrawn", no name', mine.startswith('"withdrawn","","student@thefest.in"'), mine)

            # 6. re-share
            await st.goto(f'{B}/booth/{code}')
            await st.check('input[name=adult]'); await st.click('button:has-text("Share my contact with")'); await st.wait_for_url('**shared=1')
            row = lead().split('|')
            check('6. re-sharing restores the lead with a new shared_at', row[4] == '' and row[0] == 'Arjun Sharma' and row[3] != first_shared, row)

            # 5. stop sharing from /me
            await st.goto(f'{B}/me')
            sec = st.locator('section[aria-label="Brands you shared your contact with"]')
            check('/me lists the brand and fest', 'Volt Energy' in await sec.inner_text() and 'Neon Utsav' in await sec.inner_text())
            check('15. /me at 390px: no sideways scroll, Stop sharing ≥44px', await no_sideways(st) and await min_height(st, 'button:has-text("Stop sharing")') >= 44)
            await sec.locator('button:has-text("Stop sharing")').click(); await st.wait_for_url('**stopped=1')
            check('5. stop sharing from /me works and the section hides', lead().split('|')[4] != '' and await st.locator('section[aria-label="Brands you shared your contact with"]').count() == 0)

            # 7. access
            for path in [f'/sponsor/{s1}', f'/sponsor/{s1}/report']:
                o = await login(b, 'othersponsor@seed.thefest.in'); r = await o.goto(B + path)
                check(f'7. another sponsor gets 404 on {path.replace(s1, "[id]")}', r.status == 404, r.status)
                await o.context.close()
            o = await login(b, 'othersponsor@seed.thefest.in'); r = await o.request.get(f'{B}/sponsor/{s1}/leads.csv')
            check('7. another sponsor gets 404 on leads.csv', r.status == 404, r.status); await o.context.close()
            org = await login(b, 'organizer@thefest.in'); org.on('pageerror', lambda e: errs.append(str(e)))
            for path in [f'/sponsor/{s1}', f'/sponsor/{s1}/report']:
                await org.goto(B + path); check(f'7. organizer is sent away from {path.replace(s1, "[id]")}', '/sponsor' not in org.url, org.url)
                await st.goto(B + path); check(f'7. student is sent away from {path.replace(s1, "[id]")}', '/sponsor' not in st.url, st.url)
            check('7. organizer and student get 404 on leads.csv', (await org.request.get(f'{B}/sponsor/{s1}/leads.csv')).status == 404 and (await st.request.get(f'{B}/sponsor/{s1}/leads.csv')).status == 404)
            anon = await (await b.new_context(**MOBILE)).new_page()
            check('7. logged out: leads.csv 404', (await anon.request.get(f'{B}/sponsor/{s1}/leads.csv')).status == 404)
            await anon.goto(f'{B}/sponsor/{s1}/report'); check('7. logged out: report → login', '/login' in anon.url, anon.url)
            o2 = await login(b, 'organizer2@thefest.in'); r = await o2.goto(f'{B}/organizer/{neon}/sponsors/{s1}/report')
            check('7. another organizer gets 404 on the organizer report', r.status == 404, r.status)

            # 8. organizer: counts and report, never contacts
            emails = q(f"select string_agg(email::text, ',') from sponsor_leads where sponsor_id='{s1}'").split(',')
            names = [n for n in q(f"select string_agg(name, ',') from sponsor_leads where sponsor_id='{s1}' and name is not null").split(',') if n]
            await org.goto(f'{B}/organizer/{neon}/sponsors')
            t = await text(org, '.list')
            n_now = q(f"select count(*) from sponsor_leads where sponsor_id='{s1}' and withdrawn_at is null")
            check('8. organizer sponsors tab shows the leads count', f'{n_now} leads' in t, (n_now, t[:200]))
            await org.click('a:has-text("Report") >> nth=0'); await org.wait_for_url('**/report')
            await org.goto(f'{B}/organizer/{neon}/sponsors/{s1}/report')
            body = await org.content()
            check('8. organizer report/tab never show lead names or emails', not any(e in body or e in t for e in emails) and not any(n in body for n in names))
            check('organizer report shows the deal and cost figures', 'Cost per verified attendee' in body and inr(int(amount)) in body)

            # 10. report numbers
            foot = int(q(f"select count(*) from tickets where fest_id='{neon}' and status='used'"))
            ver = q(f"select count(*) from sponsor_visits v where v.sponsor_id='{s1}' and exists (select 1 from tickets t where t.fest_id='{neon}' and t.user_id=v.user_id and t.status='used')")
            fig = lambda pg, label: pg.locator('.rp-fig', has_text=label).locator('.v').first.inner_text()
            await sp.goto(f'{B}/sponsor/{s1}/report')
            check('10. footfall = gate-scanned tickets', (await fig(sp, 'Verified footfall')).replace(',', '') == str(foot), foot)
            check('10. verified visits = visitors holding a used ticket', (await fig(sp, 'Booth visits (verified)')).replace(',', '') == ver, ver)
            check('10. cost per verified attendee = deal ÷ footfall, ₹ Indian grouping', await fig(sp, 'Cost per verified attendee') == inr(round(int(amount) / foot)), (await fig(sp, 'Cost per verified attendee'), inr(round(int(amount) / foot))))
            # ₹5,00,000 ÷ footfall worked example on a throwaway sponsorship
            tid = q(f"insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values ('{neon}', 'sponsor@thefest.in', 'ROI Test', 'Partner', {50000 * foot}, 'roitest123') returning id").split('\n')[0]
            await sp.goto(f'{B}/sponsor/{tid}/report')
            check('10. ₹500 per verified attendee example', await fig(sp, 'Cost per verified attendee') == '₹500', await fig(sp, 'Cost per verified attendee'))
            check('10. divide by zero shows "—" (no visits, no leads)', await fig(sp, 'Cost per booth visit') == '—' and await fig(sp, 'Cost per lead') == '—')
            q(f"delete from sponsors where id='{tid}'")
            await sp.goto(f'{B}/sponsor/{s2}/report')
            hv = int(q(f"select count(*) from tickets t join sponsors s on s.fest_id=t.fest_id where s.id='{s2}' and t.status='used'"))
            check('10. fest with no footfall: cost per verified attendee "—"', hv > 0 or await fig(sp, 'Cost per verified attendee') == '—', hv)

            # 12. IST hours/days, 11. small colleges, 13. badges
            await sp.goto(f'{B}/sponsor/{s1}/report')
            exp_hours = q(f"select string_agg(h||':'||n, ',' order by h) from (select extract(hour from v.created_at at time zone 'Asia/Kolkata')::int h, count(*) n from sponsor_visits v where v.sponsor_id='{s1}' and exists (select 1 from tickets t where t.fest_id='{neon}' and t.user_id=v.user_id and t.status='used') group by 1) x")
            exp = [re.sub(r'\s', '', f"{hour_label(int(x.split(':')[0]))}{x.split(':')[1]}") for x in exp_hours.split(',') if x]
            got = [re.sub(r'\s', '', r) for r in await sp.locator('section[aria-label=Booth] .row.between').all_inner_texts()]
            check('12. booth visits by hour use IST', got == exp, (got[:4], exp[:4]))
            exp_days = int(q(f"select count(distinct (checked_in_at at time zone 'Asia/Kolkata')::date) from tickets where fest_id='{neon}' and status='used'"))
            check('12. footfall by day uses IST days', await sp.locator('section[aria-label=Footfall] .row.between').count() == exp_days, exp_days)
            peak = int(q(f"select extract(hour from checked_in_at at time zone 'Asia/Kolkata')::int from tickets where fest_id='{neon}' and status='used' group by 1 order by count(*) desc, 1 limit 1"))
            check('12. peak entry hour (IST)', f'Peak entry hour: {hour_label(peak)}' in await text(sp, 'section[aria-label=Footfall]'), peak)
            aud = await text(sp, 'section[aria-label=Audience]')
            check('11. report: college under 5 merged into "Other"', 'Tiny Test College' not in aud and 'Other' in aud, aud[:200])
            t = (await text(sp)).lower()
            check('13. demo fest report shows SAMPLE and "numbers will change"', 'sample' in t and 'numbers will change' in t)
            check('15. report at 390px: no sideways scroll, print button ≥44px', await no_sideways(sp) and await min_height(sp, 'button:has-text("Print")') >= 44)
            await sp.goto(f'{B}/sponsor/{s1}')
            t = await text(sp, 'main')
            check('11. sponsor page: college under 5 merged into "Other"', 'Tiny Test College' not in t)

            # 14. print
            await org.emulate_media(media='print'); await org.set_viewport_size({'width': 1280, 'height': 900})
            await org.goto(f'{B}/organizer/{neon}/sponsors/{s1}/report')
            vis = [await org.locator(s).first.is_visible() for s in ['.side', '.tabstrip', 'button:has-text("Print")']]
            bg = await org.evaluate('getComputedStyle(document.body).backgroundColor'); fg = await org.evaluate("getComputedStyle(document.querySelector('.report h1')).color")
            check('14. print: no nav bars or buttons, black on white', not any(vis) and bg in ('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)') and fg == 'rgb(0, 0, 0)', (vis, bg, fg))
            pdf = await org.pdf(format='A4'); open(f'{E2E}/sponsor_report.pdf', 'wb').write(pdf)
            check('14. report prints to an A4 PDF', len(pdf) > 5000, len(pdf))

            # 16. privacy page
            await anon.goto(f'{B}/legal/privacy'); t = await text(anon)
            check('16. privacy page describes opt-in sharing and withdrawal', 'not your name or email' not in t and 'only if you tap' in t and 'stop sharing' in t.lower())
            check('no page errors', not errs, errs[:3])
            await b.close()

        # 17. old database without v2.5: clear message, no crash
        sh('dropdb -h /tmp -U postgres --if-exists thefest_v24 && createdb -h /tmp -U postgres thefest_v24 && '
           'pg_dump -h /tmp -U postgres thefest | psql -q -h /tmp -U postgres thefest_v24 >/dev/null 2>&1')
        OLD = 'psql -h /tmp -U postgres thefest_v24'
        q('drop table sponsor_leads; alter table sponsors drop column lead_offer', OLD)
        S = Server(3007, 'postgres://postgres@localhost:5432/thefest_v24')
        try:
            try: urllib.request.urlopen(S.base + '/api/health', timeout=20); hs, hb = 200, ''
            except urllib.error.HTTPError as e: hs, hb = e.code, e.read().decode()
            check('17. old database: health names sponsor_leads and sponsors.lead_offer', hs == 503 and 'sponsor_leads' in hb and 'sponsors.lead_offer' in hb, hb[:200])
            async with async_playwright() as p:
                b = await p.chromium.launch()
                sp = await login(b, 'sponsor@thefest.in', S.base)
                r = await sp.goto(f'{S.base}/sponsor/{s1}')
                check('17. old database: sponsor page works and says leads need v2.5', r.status == 200 and 'v2.5' in await text(sp), r.status)
                r = await sp.goto(f'{S.base}/sponsor/{s1}/report')
                check('17. old database: report works (leads "—")', r.status == 200 and await sp.locator('.rp-fig', has_text='Leads').locator('.v').first.inner_text() == '—', r.status)
                st = await login(b, 'student@thefest.in', S.base)
                r = await st.goto(f'{S.base}/booth/{code}')
                check('17. old database: booth check-in page works, no share card', r.status == 200 and await st.locator('text=Want Volt Energy').count() == 0, r.status)
                r = await st.goto(f'{S.base}/me'); check('17. old database: /me works', r.status == 200, r.status)
                org = await login(b, 'organizer@thefest.in', S.base)
                r = await org.goto(f'{S.base}/organizer/{neon}/sponsors'); check('17. old database: organizer sponsors tab works', r.status == 200 and '0 leads' in await text(org, 'body'), r.status)
                await b.close()
        finally:
            S.stop(); sh('dropdb -h /tmp -U postgres --if-exists thefest_v24')
    finally:
        q(f"update users set college={'NULL' if not tiny_old else chr(39) + tiny_old + chr(39)} where id='{tiny_uid}'")
        q(f"update users set phone=null where id='{stu}'")
        q("delete from sponsors where booth_code='roitest123'")
        q("delete from users where email='othersponsor@seed.thefest.in'")

    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} sponsor-leads checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

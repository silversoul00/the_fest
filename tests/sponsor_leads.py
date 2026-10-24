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
def inr(paise):  # same as rupees() in src/lib/format.ts: whole rupees, or always two decimals
    d = 0 if paise % 100 == 0 else 2
    return subprocess.run(['node', '-e', f'console.log("₹"+({paise}/100).toLocaleString("en-IN",{{minimumFractionDigits:{d},maximumFractionDigits:{d}}}))'], capture_output=True, text=True).stdout.strip()
async def clipped(pg, sel):
    """Texts inside `sel` that are cut off (wider than their box)."""
    return await pg.evaluate('''(sel) => [...document.querySelectorAll(sel + ' *')].filter(e => e.offsetParent && e.children.length === 0
        && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => e.textContent.slice(0, 60))''', sel)
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
    # fix-round users: a confirmed student with no ticket, an unconfirmed student with no college
    for em, nm, col, ver in [('ticketless@seed.thefest.in', 'Tara Ticketless', 'Nowhere College', 'now()'), ('unconfirmed@seed.thefest.in', 'Uma Unconfirmed', None, 'null')]:
        q(f"insert into users (email, password_hash, name, role, college, email_verified_at) select '{em}', password_hash, '{nm}', 'student', {repr(col) if col else 'null'}, {ver} from users where email='sponsor@thefest.in' on conflict (email) do nothing")
    admin_id = q("select id from users where email='admin@thefest.in'")
    lead = lambda: q(f"select coalesce(name,'')||'|'||coalesce(phone,'')||'|'||coalesce(course_year,'')||'|'||shared_at||'|'||coalesce(withdrawn_at::text,'') from sponsor_leads where sponsor_id='{s1}' and user_id='{stu}'")
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            errs = []
            st = await login(b, 'student@thefest.in'); st.on('pageerror', lambda e: errs.append(str(e)))

            # R9. seeded demo visits and leads are never in the future
            check('R9. seed: no booth visit, share or withdrawal is in the future',
                  q("select count(*) from sponsor_visits where created_at > now()") == '0' and
                  q("select count(*) from sponsor_leads where shared_at > now() or withdrawn_at > now()") == '0')
            check('R2. money keeps two decimals when not whole (₹6,024.10), none when whole', inr(602410) == '₹6,024.10' and inr(50000000) == '₹5,00,000' and inr(1250) == '₹12.50')

            # 1. check in without sharing, still one tap
            await st.goto(f'{B}/booth/{code}')
            check('1. booth: share card hidden before check-in', await st.locator('text=Want Volt Energy to contact you?').count() == 0)
            await st.click('button:has-text("Check in at")'); await st.wait_for_url('**done=1')
            check('1. one tap checks in without sharing', q(f"select count(*) from sponsor_visits where sponsor_id='{s1}' and user_id='{stu}'") == '1'
                  and q(f"select count(*) from sponsor_leads where user_id='{stu}'") == '0')
            stu_college = q(f"select college from users where id='{stu}'")
            dl = await text(st, 'dl.lead-items')
            check('1. after check-in the optional share card shows the itemised notice',
                  (lambda body: all(t in body for t in ['Want Volt Energy to contact you?', 'Volt Energy will get:', 'Data Protection Board of India']))(await text(st)))
            check('R7. notice shows the actual name, email, college and phone that would be sent',
                  all(t in dl for t in ['Arjun Sharma', 'student@thefest.in', stu_college, '9876500000']), dl)
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
            check('R6. shared state: "If you stop, Volt Energy will be told to delete your details"', 'If you stop, Volt Energy will be told to delete your details' in await text(st))
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

            # R-must-3. unconfirmed student: confirm-email notice with resend instead of the share form; forged POST still refused
            un = await login(b, 'unconfirmed@seed.thefest.in'); un.on('pageerror', lambda e: errs.append(str(e)))
            uid = q("select id from users where email='unconfirmed@seed.thefest.in'")
            await un.goto(f'{B}/booth/{code}'); await un.click('button:has-text("Check in at")'); await un.wait_for_url('**done=1')
            card = un.locator('section[aria-label="Share your contact"]')
            ct = await card.inner_text()
            check('R3. unconfirmed: confirm-email notice with resend, no share form',
                  'Confirm your email' in ct and await card.locator('button:has-text("Send the link again")').count() == 1 and await un.locator('input[name=adult]').count() == 0, ct[:200])
            check('R7/should-7. no college on the account → "College" not listed', 'College' not in await text(un, 'dl.lead-items') and 'Uma Unconfirmed' in ct)
            await forge_share(un, share_html, adult=True)
            check('R3. forged share from an unconfirmed account → err=verify, no row', 'err=verify' in un.url and q(f"select count(*) from sponsor_leads where user_id='{uid}'") == '0', un.url)
            check('R3. unconfirmed booth page at 390px: no sideways scroll', await no_sideways(un))

            # R-must-1. a lead from a student with no gate-scanned ticket: lead rate uses all booth visits, never > 100%
            tl = await login(b, 'ticketless@seed.thefest.in'); tl.on('pageerror', lambda e: errs.append(str(e)))
            await tl.goto(f'{B}/booth/{code}'); await tl.click('button:has-text("Check in at")'); await tl.wait_for_url('**done=1')
            await tl.check('input[name=adult]'); await tl.click('button:has-text("Share my contact with")'); await tl.wait_for_url('**shared=1')
            await tl.goto(f'{B}/me')
            check('R1. ticketless student shared and sees it in /me', 'Volt Energy' in await text(tl))
            fig = lambda pg, label: pg.locator('.rp-fig', has_text=label).locator('.v').first.inner_text()
            n_leads = int(q(f"select count(*) from sponsor_leads where sponsor_id='{s1}' and withdrawn_at is null"))
            v_all = int(q(f"select count(*) from sponsor_visits where sponsor_id='{s1}'"))
            await sp.goto(f'{B}/sponsor/{s1}/report')
            rate = await fig(sp, 'Lead rate')
            check('R1. lead rate = leads ÷ all booth visits (≤100%)', rate == f'{round(n_leads / v_all * 100)}%' and int(rate.rstrip('%')) <= 100, (rate, n_leads, v_all))
            check('R1. cost per lead = deal ÷ active leads', await fig(sp, 'Cost per lead') == inr(round(int(amount) / n_leads)))
            hw = await text(sp, 'section[aria-label="How we counted"]')
            check('R1. "How we counted" explains the lead rate base', 'leads ÷ all booth visits' in hw and 'Booth visits (total)' in hw, hw[:300])
            # lead rate can't pass 100% even when every visitor shared (tiny throwaway sponsor: 1 ticketless visit, 1 lead)
            tid2 = q(f"insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values ('{neon}', 'sponsor@thefest.in', 'Rate Test', 'Partner', 100000, 'ratetest123') returning id").split('\n')[0]
            tlid = q("select id from users where email='ticketless@seed.thefest.in'")
            q(f"insert into sponsor_visits (sponsor_id, user_id) values ('{tid2}', '{tlid}'); insert into sponsor_leads (sponsor_id, user_id, name, email, notice_version) values ('{tid2}', '{tlid}', 'Tara', 'ticketless@seed.thefest.in', 'lead-v1')")
            await sp.goto(f'{B}/sponsor/{tid2}/report')
            check('R1. every visitor shared, none verified → lead rate 100%, not more', await fig(sp, 'Lead rate') == '100%', await fig(sp, 'Lead rate'))
            q(f"delete from sponsors where id='{tid2}'")

            # R-should-4, R5, R8: sponsor dashboard labels, leads card and offer field at 390px
            await sp.goto(f'{B}/sponsor/{s1}')
            vt = await sp.locator('.stat', has_text='Booth visits (verified)').inner_text()
            ver_now = int(q(f"select count(*) from sponsor_visits v where v.sponsor_id='{s1}' and exists (select 1 from tickets t where t.fest_id='{neon}' and t.user_id=v.user_id and t.status='used')"))
            check('R5. dashboard: "N in total (M unverified)" and "verified today"', f'{v_all} in total ({v_all - ver_now} unverified)' in vt and 'verified today' in vt, vt)
            check('R-should-4. hourly chart is labelled verified', await sp.locator('text=Verified booth visits by hour').count() == 1)
            check('R8. leads card at 390px: course/year and names not cut off', await clipped(sp, 'section[aria-label=Leads]') == [], await clipped(sp, 'section[aria-label=Leads]'))
            offer = sp.locator('input[name=lead_offer]')
            ph = await offer.get_attribute('placeholder'); old_val = await offer.input_value()
            await offer.fill(ph)
            fits = await offer.evaluate('e => e.scrollWidth <= e.clientWidth + 1'); await offer.fill(old_val)
            check('R8. offer field placeholder fits at 390px', fits, ph)

            # R-tester-1, R3, must-2: organizer sponsors tab at 390px; remove is refused for a sponsor with leads
            await org.goto(f'{B}/organizer/{neon}/sponsors')
            row = org.locator(f'[data-sponsor="{s1}"]')
            counts = await row.locator('.sponsor-counts').inner_text()
            check('R-T1. organizer tab at 390px: counts line fully visible, "N verified · M total booth visits · K leads"',
                  counts == f'{ver_now} verified · {v_all} total booth visits · {n_leads} leads' and await clipped(org, f'[data-sponsor="{s1}"]') == [], counts)
            check('R-T1. organizer tab at 390px: no sideways scroll; Report, Booth QR and ✕ ≥44px',
                  await no_sideways(org) and await min_height(org, f'[data-sponsor="{s1}"] .btn') >= 44, await min_height(org, f'[data-sponsor="{s1}"] .btn'))
            await row.locator('a[aria-label="Remove Volt Energy"]').click(); await org.wait_for_url(f'**remove={s1}')
            box = org.locator('section[aria-label="Remove sponsor"]')
            check('R-M2. ✕ on a sponsor with leads: page explains it can\'t be removed, no remove button',
                  "can't be removed" in await box.inner_text() and await box.locator('button').count() == 0)
            n_rows = q(f"select count(*) from sponsor_leads where sponsor_id='{s1}'")
            dz = q(f"insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values ('{neon}', 'nobody@seed.thefest.in', 'Zero Leads', 'Partner', 0, 'zeroleads123') returning id").split('\n')[0]
            await org.goto(f'{B}/organizer/{neon}/sponsors?remove={dz}')
            check('R-M2. ✕ on a sponsor with no leads asks to confirm on the page', 'Remove Zero Leads?' in await box.inner_text() and await box.locator('a:has-text("Cancel")').count() == 1)
            # forged: point the confirm form at Volt Energy → refused by the server
            await box.locator('input[name=id]').evaluate(f'e => e.value = "{s1}"')
            await box.locator('button:has-text("Yes, remove")').click(); await org.wait_for_url('**err=leads')
            check('R-M2. server refuses removing a sponsor with leads (forged request)', q(f"select count(*) from sponsors where id='{s1}'") == '1'
                  and q(f"select count(*) from sponsor_leads where sponsor_id='{s1}'") == n_rows and "can't be removed" in await text(org, '[role=alert]'))
            await tl.goto(f'{B}/me')
            check('R-M2. the student\'s /me entry is still there', 'Volt Energy' in await text(tl))
            await org.goto(f'{B}/organizer/{neon}/sponsors?remove={dz}')
            await box.locator('button:has-text("Yes, remove")').click(); await org.wait_for_url('**removed=1')
            check('R-M2. a sponsor with no leads can still be removed', q(f"select count(*) from sponsors where id='{dz}'") == '0')

            # 10. report numbers
            foot = int(q(f"select count(*) from tickets where fest_id='{neon}' and status='used'"))
            ver = q(f"select count(*) from sponsor_visits v where v.sponsor_id='{s1}' and exists (select 1 from tickets t where t.fest_id='{neon}' and t.user_id=v.user_id and t.status='used')")
            fig = lambda pg, label: pg.locator('.rp-fig', has_text=label).locator('.v').first.inner_text()
            await sp.goto(f'{B}/sponsor/{s1}/report')
            check('10. footfall = gate-scanned tickets', (await fig(sp, 'Verified footfall')).replace(',', '') == str(foot), foot)
            check('10. verified visits = visitors holding a used ticket', (await fig(sp, 'Booth visits (verified)')).replace(',', '') == ver, ver)
            rsub = await sp.locator('.rp-fig', has_text='Booth visits (verified)').locator('.s').inner_text()
            check('R5. report: "N in total (M unverified)"', rsub == f'{v_all} in total ({v_all - int(ver)} unverified)', rsub)
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
            # R10. a real fest run from a staff @thefest.in account (not a demo organizer) is never labelled SAMPLE
            rf = q(f"insert into fests (slug, organizer_id, name, college, city, starts_on, ends_on, status) select 'real-fest-r1', '{admin_id}', 'Real Fest', college, city, starts_on, ends_on, 'live' from fests where id='{neon}' returning id").split('\n')[0]
            rs = q(f"insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values ('{rf}', 'sponsor@thefest.in', 'Real Brand', 'Partner', 100000, 'realfest123') returning id").split('\n')[0]
            await sp.goto(f'{B}/sponsor/{rs}/report')
            check('R10. real fest (admin@thefest.in organizer, sponsor@thefest.in brand): no SAMPLE label', 'sample' not in (await text(sp)).lower() and 'Real Brand' in await text(sp))
            q(f"delete from fests where id='{rf}'")
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
        q("delete from fests where slug='real-fest-r1'"); q("delete from sponsors where booth_code in ('ratetest123','zeroleads123')")
        q("delete from users where email in ('ticketless@seed.thefest.in','unconfirmed@seed.thefest.in')")

    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} sponsor-leads checks passed")
    sys.exit(0 if results and all(ok for _, ok in results) else 1)

asyncio.run(main())

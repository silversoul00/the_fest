// Seeds demo data: fictional fests, demo accounts, sales, scans, sponsors.
// Dates are relative to today, so the demo never looks out of date.
//
//   npm run db:seed            → only runs on an empty database
//   npm run db:seed -- --reset → WIPES ALL DATA first (local/dev only!)
//   Refuses any non-local DATABASE_URL unless --allow-remote is passed.
//
// Demo logins (password: password123)
//   student@thefest.in · organizer@thefest.in · sponsor@thefest.in · volunteer@thefest.in
import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { loadEnv } from './env.mjs';

loadEnv();
// Demo data includes an admin account with a public password, so it must never reach a real database.
const isLocalDb = (url) => { const m = (url ?? '').match(/@([^/@?]+?)(?::\d+)?(?:[/?]|$)/); return !!m && ['localhost', '127.0.0.1', '[::1]'].includes(m[1].toLowerCase()); };
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set (put it in .env.local)'); process.exit(1); }
if (!isLocalDb(process.env.DATABASE_URL) && !process.argv.includes('--allow-remote')) {
  console.error('Refusing to seed: DATABASE_URL is not a local database. Demo data (with a demo admin account and the password "password123") must never go into a real database. If this really is a throwaway test database, add --allow-remote.');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {}, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') ? false : 'require' });
const reset = process.argv.includes('--reset');

// Days are IST days, like the app (between 6:30 PM and midnight UTC, India is already on the next date)
const day = (offset) => {
  const d = new Date(Date.now() + 5.5 * 3600e3 + offset * 864e5);
  return d.toISOString().slice(0, 10);
};
const at = (dayOffset, hh, mm = 0) => {
  // IST wall-clock → UTC timestamp
  const d = new Date(day(dayOffset) + 'T00:00:00+05:30');
  d.setUTCMinutes(d.getUTCMinutes() + hh * 60 + mm);
  return d;
};
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const code = () => { const c = Array.from(randomBytes(8), (x) => ALPHA[x % ALPHA.length]).join(''); return `TF-${c.slice(0, 4)}-${c.slice(4)}`; };
const pick = (a) => a[randomInt(a.length)];

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Karthik', 'Meera', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Rahul', 'Ishita', 'Nikhil', 'Pooja', 'Siddharth', 'Tanvi', 'Aditya', 'Nandini', 'Varun', 'Shreya'];
const LAST = ['Rao', 'Sharma', 'Iyer', 'Reddy', 'Nair', 'Gowda', 'Menon', 'Kulkarni', 'Hegde', 'Shetty', 'Patil', 'Bhat'];
const COLLEGES = ['Demo Institute of Technology', 'Sample School of Design', 'Example College of Commerce', 'Placeholder University'];

try {
  const [{ n }] = await sql`select count(*)::int as n from fests`;
  if (n > 0 && !reset) {
    console.log('Database already has fests — skipping. Use --reset to wipe and reseed (dev only).');
    process.exit(0);
  }
  if (reset) {
    if (/supabase\.(co|com)/.test(process.env.DATABASE_URL) && !process.argv.includes('--yes-really')) {
      console.error('Refusing to --reset a Supabase database. Add --yes-really if you are sure.');
      process.exit(1);
    }
    await sql`truncate login_attempts, app_errors, app_alert_state, email_verifications, payouts, upi_credits, fest_members, password_resets, email_outbox, sponsor_visits, sponsors, announcements, schedule_events, fest_staff, fest_roles, fest_activity, scans, tickets, orders, ticket_types, fests, sessions, users restart identity cascade`;
    console.log('• wiped');
  }

  const hash = await bcrypt.hash('password123', 10);
  const mkUser = async (email, name, role, college = null) =>
    (await sql`insert into users (email, password_hash, name, role, college, email_verified_at) values (${email}, ${hash}, ${name}, ${role}, ${college}, now()) returning id`)[0].id;

  const organizer = await mkUser('organizer@thefest.in', 'Riya Kapoor', 'organizer', COLLEGES[0]);
  const organizer2 = await mkUser('organizer2@thefest.in', 'Dev Malhotra', 'organizer', COLLEGES[1]);
  const student = await mkUser('student@thefest.in', 'Arjun Sharma', 'student', COLLEGES[2]);
  await mkUser('sponsor@thefest.in', 'Neha Brand Manager', 'sponsor');
  const volunteer = await mkUser('volunteer@thefest.in', 'Kiran Volunteer', 'student', COLLEGES[0]);
  const admin = await mkUser('admin@thefest.in', 'THE FEST Admin', 'organizer');
  await mkUser('lunch@seed.thefest.in', 'Lata Lunch', 'student', COLLEGES[0]);
  await mkUser('stay@seed.thefest.in', 'Sunil Stay', 'student', COLLEGES[0]);
  // Every seeded role holder can log in (password123, email confirmed) — only newvolunteer@ stays "no account yet"
  for (const [e, n] of [['gate2@seed.thefest.in', 'Manoj Gate'], ['gate3@seed.thefest.in', 'Priya Gate'], ['desk@seed.thefest.in', 'Lakshmi Desk'], ['stage@seed.thefest.in', 'Rahul Stage']]) await mkUser(e, n, 'student', COLLEGES[0]);
  await sql`update users set is_admin = true where id = ${admin}`;

  // ~120 attendees
  const crowd = [];
  for (let i = 0; i < 120; i++) {
    // Never the demo student's name: tests (and people) tell "Arjun Sharma" apart from the crowd by name
    let nm = `${pick(FIRST)} ${pick(LAST)}`;
    while (nm === 'Arjun Sharma') nm = `${pick(FIRST)} ${pick(LAST)}`;
    crowd.push(await mkUser(`attendee${i + 1}@seed.thefest.in`, nm, 'student', pick(COLLEGES)));
  }

  const FESTS = [
    { slug: 'neon-utsav', org: organizer, name: 'Neon Utsav', college: COLLEGES[0], city: 'Bengaluru', venue: 'Main Grounds, Block A', category: 'cultural', s: -1, e: 1, emoji: '🎆', accent: '#FFE034', cap: 3000,
      desc: 'Three nights of pro shows, dance battles and an indie music stage. The flagship sample fest on THE FEST — explore it to see how everything works.',
      types: [['Day Pass', 'Entry for one day, all open events', 29900, 1200], ['3-Day Pass', 'All three days + pro night standing, lunch on days 2–3 and hostel stay', 69900, 900, { lunch: [0, 1], stay: true }], ['VIP Pro Night', 'Front pit for the headline act', 149900, 150],
             ['Lunch add-on', 'Lunch on days 2–3', 9900, 500, { lunch: [0, 1], addon: true }]] },
    { slug: 'hackverse', org: organizer, name: 'Hackverse 36', college: COLLEGES[0], city: 'Bengaluru', venue: 'Innovation Centre', category: 'tech', s: 12, e: 13, emoji: '🚀', accent: '#38BDF8', cap: 600,
      desc: 'A 36-hour student hackathon with workshops, mentor hours and ₹2L in prizes. Sample data.',
      types: [['Hacker (team member)', 'One seat in a team of up to 4', 0, 400], ['Workshop Pass', 'All workshops, no hacking', 19900, 200]] },
    { slug: 'kalaa-fest', org: organizer2, name: 'Kalaa', college: COLLEGES[1], city: 'Mysuru', venue: 'Open Air Theatre', category: 'cultural', s: 21, e: 23, emoji: '🎨', accent: '#FF5C1A', cap: 2000,
      desc: 'Art, design and performance — street art walls, a fashion show and a folk-fusion night. Sample data.',
      types: [['General', 'All days, all stages', 39900, 1500], ['Workshop Bundle', 'General + 3 art workshops', 79900, 120]] },
    { slug: 'commerce-carnival', org: organizer2, name: 'Commerce Carnival', college: COLLEGES[2], city: 'Bengaluru', venue: 'Auditorium & Quad', category: 'management', s: 34, e: 35, emoji: '📈', accent: '#00E5A0', cap: 1200,
      desc: 'B-plan battles, a mock stock exchange and the best-manager hunt. Sample data.',
      types: [['Delegate', 'All events + lunch', 49900, 800]] },
    { slug: 'campus-beats', org: organizer2, name: 'Campus Beats', college: COLLEGES[3], city: 'Bengaluru', venue: 'Amphitheatre', category: 'cultural', s: 45, e: 46, emoji: '🎤', accent: '#B794F6', cap: 1500,
      desc: 'Battle of the bands and a DJ night. Waiting for THE FEST approval — sample data.',
      types: [['Entry', 'Both days', 19900, 1000]], status: 'review' },
    { slug: 'goal-rush', org: organizer, name: 'Goal Rush', college: COLLEGES[3], city: 'Bengaluru', venue: 'Sports Complex', category: 'sports', s: -40, e: -38, emoji: '⚽', accent: '#FF2D55', cap: 1000,
      desc: 'Inter-college football and futsal. This one already happened — sample data.',
      types: [['Spectator', 'All matches', 9900, 900]], status: 'ended' },
  ];

  const festIds = {};
  const typeIds = {};
  for (const f of FESTS) {
    const [row] = await sql`
      insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
      values (${f.slug}, ${f.org}, ${f.name}, ${f.college}, ${f.city}, ${f.venue}, ${f.category}, ${day(f.s)}, ${day(f.e)}, ${f.desc}, ${f.emoji}, ${f.accent}, ${f.cap}, ${f.status ?? 'live'}, ${f.status === 'review' ? null : new Date()})
      returning id`;
    festIds[f.slug] = row.id;
    typeIds[f.slug] = [];
    let sort = 0;
    for (const [name, description, price, quota, perks = {}] of f.types) {
      const lunch = `{${(perks.lunch ?? []).map(day).join(',')}}`;
      const [t] = await sql`insert into ticket_types (fest_id, name, description, price_paise, quota, sort, kind, lunch_days, includes_stay)
                            values (${row.id}, ${name}, ${description}, ${price}, ${quota}, ${sort++},
                                    ${perks.addon ? 'addon' : 'entry'}, ${lunch}::date[], ${!!perks.stay}) returning id, price_paise`;
      typeIds[f.slug].push(t);
    }
  }

  // Sales: orders + tickets, spread over the last 3 weeks
  const FEE = 1500;
  async function sell(slug, buyer, typeIdx, qty, daysAgo, provider = 'demo') {
    const t = typeIds[slug][typeIdx];
    const subtotal = t.price_paise * qty;
    const fee = t.price_paise > 0 ? FEE * qty : 0;
    const created = new Date(Date.now() - daysAgo * 864e5 - randomInt(36e5 * 20));
    const [o] = await sql`
      insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, status, provider, created_at, paid_at)
      values (${buyer}, ${festIds[slug]}, ${t.id}, ${qty}, ${subtotal + fee}, ${fee}, 'paid', ${t.price_paise ? provider : 'free'}, ${created}, ${created})
      returning id, user_id`;
    const [{ name }] = await sql`select name from users where id = ${buyer}`;
    const ids = [];
    for (let i = 0; i < qty; i++) {
      const [tk] = await sql`insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name, issued_at)
        values (${code()}, ${o.id}, ${buyer}, ${festIds[slug]}, ${t.id}, ${qty > 1 ? `${name} (${i + 1}/${qty})` : name}, ${created}) returning id`;
      ids.push(tk.id);
    }
    await sql`update ticket_types set sold = sold + ${qty} where id = ${t.id}`;
    return ids;
  }

  const neonTickets = [];
  for (const [i, buyer] of crowd.entries()) {
    const typeIdx = i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
    neonTickets.push(...(await sell('neon-utsav', buyer, typeIdx, i % 9 === 0 ? 2 : 1, randomInt(21))));
  }
  for (const buyer of crowd.slice(0, 45)) await sell('hackverse', buyer, randomInt(2), 1, randomInt(10));
  for (const buyer of crowd.slice(40, 95)) await sell('kalaa-fest', buyer, randomInt(10) < 8 ? 0 : 1, 1, randomInt(14));
  for (const buyer of crowd.slice(60, 90)) await sell('commerce-carnival', buyer, 0, 1, randomInt(7));
  const goalTickets = [];
  for (const buyer of crowd.slice(0, 70)) goalTickets.push(...(await sell('goal-rush', buyer, 0, 1, 45 + randomInt(10))));

  // Demo student owns tickets
  await sell('neon-utsav', student, 1, 1, 3);
  await sell('hackverse', student, 0, 1, 1);

  // Staff
  // Team & Roles (v2.7). Gate team (as before) plus role holders on normal student accounts.
  const staff = [
    ['volunteer@thefest.in', 'Kiran Volunteer', 'vol_gate', 'Gate 1', true],
    ['organizer@thefest.in', 'Riya Kapoor', 'vol_gate', 'Gate 1', true],
    ['gate2@seed.thefest.in', 'Manoj Gate', 'vol_gate', 'Gate 2', true],
    ['gate3@seed.thefest.in', 'Priya Gate', 'vol_gate', 'Gate 3', true],
    ['desk@seed.thefest.in', 'Lakshmi Desk', 'desk', 'Registration desk', true],
    ['stage@seed.thefest.in', 'Rahul Stage', 'vol_gate', 'Main stage', false],
    ['lunch@seed.thefest.in', 'Lata Lunch', 'vol_lunch', 'Lunch counter', true],
    ['stay@seed.thefest.in', 'Sunil Stay', 'vol_stay', 'Stay desk', true],
  ];
  for (const [i, [email, name, role, duty, scan]] of staff.entries()) {
    await sql`insert into fest_roles (fest_id, email, name, role, duty, can_scan, checked_in_at, added_by)
              values (${festIds['neon-utsav']}, ${email}, ${name}, ${role}, ${duty}, ${scan}, ${i < 4 ? at(0, 9, 10 * i) : null}, ${organizer})`;
  }
  await sql`insert into fest_roles (fest_id, email, name, role, duty, added_by) values (${festIds['hackverse']}, 'volunteer@thefest.in', 'Kiran Volunteer', 'vol_gate', 'Gate 1', ${organizer})`;
  const holders = [
    ['cohost@seed.thefest.in', 'Chetan Cohost', 'co_organizer', null, null],
    ['finance@seed.thefest.in', 'Farah Finance', 'finance', null, null],
    ['sponsorlead@seed.thefest.in', 'Sameer Sponsorship', 'sponsorship', null, null],
    ['media@seed.thefest.in', 'Meera Media', 'media', null, null],
    ['media@seed.thefest.in', 'Meera Media', 'judge', 'Battle of Bands', null],
    ['eventhead@seed.thefest.in', 'Esha Events', 'event_head', 'Battle of Bands', null],
    ['judge@seed.thefest.in', 'Jai Judge', 'judge', 'Fashion Show', day(1)],
  ];
  for (const [email, name, role, label, d] of holders) {
    if (!(await sql`select 1 from users where email = ${email}`).length) await mkUser(email, name, 'student', COLLEGES[0]);
    await sql`insert into fest_roles (fest_id, email, name, role, scope_label, scope_day, added_by)
              values (${festIds['neon-utsav']}, ${email}, ${name}, ${role}, ${label}, ${d}, ${organizer})`;
  }
  // Pending: added, but no account yet
  await sql`insert into fest_roles (fest_id, email, name, role, added_by) values (${festIds['neon-utsav']}, 'newvolunteer@seed.thefest.in', 'Nisha New', 'vol_gate', ${organizer})`;
  await sql`insert into fest_activity (fest_id, actor_id, actor_email, actor_role, action, summary) values
    (${festIds['neon-utsav']}, ${organizer}, 'organizer@thefest.in', 'owner', 'role.add', 'Added Farah Finance as Finance lead'),
    (${festIds['neon-utsav']}, ${organizer}, 'organizer@thefest.in', 'owner', 'role.add', 'Added Meera Media as Media / PR')`;

  // Check-ins: Neon Utsav day 1 + today; Goal Rush all-but-few
  const gates = ['Gate 1', 'Gate 2', 'Gate 3'];
  const checkIn = async (fest, ticketId, when) => {
    const gate = pick(gates);
    await sql`update tickets set status = 'used', checked_in_at = ${when}, checked_in_by = ${volunteer}, gate = ${gate} where id = ${ticketId}`;
    await sql`insert into scans (fest_id, ticket_id, scanned_by, gate, result, created_at) values (${fest}, ${ticketId}, ${volunteer}, ${gate}, 'admitted', ${when})`;
  };
  for (const id of neonTickets.slice(0, Math.floor(neonTickets.length * 0.62))) {
    await checkIn(festIds['neon-utsav'], id, at(0, 9 + randomInt(9), randomInt(60)));
  }
  for (let i = 0; i < 6; i++) {
    await sql`insert into scans (fest_id, ticket_id, scanned_by, gate, result, detail, created_at)
              values (${festIds['neon-utsav']}, ${neonTickets[i]}, ${volunteer}, ${pick(gates)}, 'duplicate', 'Already used', ${at(0, 12 + i, 5)})`;
  }
  for (let i = 0; i < 3; i++) {
    await sql`insert into scans (fest_id, scanned_by, gate, result, detail, created_at)
              values (${festIds['neon-utsav']}, ${volunteer}, ${pick(gates)}, 'invalid', 'Signature check failed', ${at(0, 13 + i, 20)})`;
  }
  for (const id of goalTickets.slice(0, 64)) await checkIn(festIds['goal-rush'], id, at(-40, 10 + randomInt(6), randomInt(60)));

  // Schedule (Neon Utsav runs day -1 … +1)
  const SCHED = [
    [-1, 10, 12, 'Inauguration & Lamp Lighting', 'Main Stage', 'ceremony'],
    [-1, 14, 17, 'Battle of Bands — Prelims', 'Indie Stage', 'music'],
    [-1, 19, 22, 'Bollywood Night', 'Main Grounds', 'pro-show'],
    [0, 10, 13, 'Street Dance Battle', 'Quad', 'dance'],
    [0, 11, 13, 'Treasure Hunt', 'Campus-wide', 'fun'],
    [0, 14, 16, 'Open Mic', 'Indie Stage', 'music'],
    [0, 16, 18, 'Fashion Walk', 'Main Stage', 'fashion'],
    [0, 19, 23, 'EDM Pro Night', 'Main Grounds', 'pro-show'],
    [1, 10, 12, 'Quiz — Finals', 'Auditorium', 'quiz'],
    [1, 13, 16, 'Battle of Bands — Finals', 'Indie Stage', 'music'],
    [1, 19, 22, 'Headliner Concert', 'Main Grounds', 'pro-show'],
  ];
  for (const [d, s, e, title, venue, category] of SCHED) {
    await sql`insert into schedule_events (fest_id, title, venue, category, starts_at, ends_at)
              values (${festIds['neon-utsav']}, ${title}, ${venue}, ${category}, ${at(d, s)}, ${at(d, e)})`;
  }
  for (const [d, s, e, title, venue] of [[12, 9, 10, 'Check-in & Breakfast', 'Lobby'], [12, 10, 11, 'Opening Keynote', 'Hall A'], [12, 11, 23, 'Hacking — Round 1', 'Labs'], [13, 10, 13, 'Final Demos', 'Hall A'], [13, 15, 16, 'Prize Ceremony', 'Hall A']]) {
    await sql`insert into schedule_events (fest_id, title, venue, starts_at, ends_at) values (${festIds['hackverse']}, ${title}, ${venue}, ${at(d, s)}, ${at(d, e)})`;
  }

  // Announcements
  await sql`insert into announcements (fest_id, title, body, urgent, created_at) values
    (${festIds['neon-utsav']}, 'Gate 2 is crowded', 'Please use Gate 3 near the parking lot — shorter queue.', true, ${at(0, 17, 40)}),
    (${festIds['neon-utsav']}, 'EDM Pro Night starts 7 PM', 'Gates to the Main Grounds open at 6:15. Carry your QR pass.', false, ${at(0, 12)}),
    (${festIds['neon-utsav']}, 'Welcome to Neon Utsav!', 'Food court is at Block C. Water stations at every gate.', false, ${at(-1, 9)}),
    (${festIds['hackverse']}, 'Team registrations close soon', 'Lock your team of up to 4 before the event week.', false, ${at(-1, 18)})`;

  // Sponsors (sponsor@thefest.in sees these). Fictional brands.
  const sp = async (slug, brand, tier, amount) =>
    (await sql`insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code)
               values (${festIds[slug]}, 'sponsor@thefest.in', ${brand}, ${tier}, ${amount}, ${randomBytes(9).toString('base64url')}) returning id`)[0].id;
  const s1 = await sp('neon-utsav', 'Volt Energy', 'Title', 50000000);
  const s2 = await sp('hackverse', 'Volt Energy', 'Powered by', 15000000);
  await sql`insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values
    (${festIds['neon-utsav']}, 'brand@seed.thefest.in', 'Chai Point Express', 'Associate', 10000000, ${randomBytes(9).toString('base64url')}),
    (${festIds['neon-utsav']}, 'brand2@seed.thefest.in', 'PixelPhone', 'Partner', 7500000, ${randomBytes(9).toString('base64url')})`;
  // Booth visits during fest hours, never in the future: a time later than now moves to yesterday (fest day 1).
  const past = (hh, mm) => { const t = at(0, hh, mm); return t.getTime() < Date.now() - 5 * 60e3 ? t : at(-1, hh, mm); };
  for (const u of crowd.slice(0, 74)) await sql`insert into sponsor_visits (sponsor_id, user_id, created_at) values (${s1}, ${u}, ${past(10 + randomInt(9), randomInt(60))})`;
  for (const u of crowd.slice(0, 12)) await sql`insert into sponsor_visits (sponsor_id, user_id) values (${s2}, ${u})`;
  // Sample leads: 10 booth visitors chose to share with Volt Energy at Neon Utsav; one later stopped sharing.
  const COURSES = ['B.E. CSE, 3rd year', 'B.Com, 2nd year', 'B.Des, final year', null, 'MBA, 1st year'];
  for (const [i, u] of crowd.slice(0, 10).entries()) {
    await sql`insert into sponsor_leads (sponsor_id, user_id, name, email, college, course_year, notice_version, shared_at)
              select ${s1}, u.id, u.name, u.email, u.college, ${COURSES[i % COURSES.length]}, 'lead-v1', least(v.created_at + interval '1 minute', now())
              from users u join sponsor_visits v on v.user_id = u.id where u.id = ${u} and v.sponsor_id = ${s1}`;
  }
  await sql`update sponsor_leads set name = null, college = null, course_year = null, withdrawn_at = least(shared_at + interval '2 hours', now())
            where sponsor_id = ${s1} and user_id = ${crowd[9]}`;

  // Sponsorship requests (v2.6): two listed brands, two fests open to brands, requests both ways in each status.
  const [{ id: volt }] = await sql`select id from users where email = 'sponsor@thefest.in'`;
  const chai = await mkUser('brand@seed.thefest.in', 'Kabir Chai Point', 'sponsor');
  await sql`insert into brand_profiles (user_id, brand, category, budget_min_paise, budget_max_paise, cities, about, listed) values
    (${volt}, 'Volt Energy', 'food', 5000000, 50000000, '{Bengaluru,Mysuru}', 'Energy drinks for students who stay up for the pro night.', true),
    (${chai}, 'Chai Point Express', 'food', 2500000, 15000000, '{Bengaluru}', 'Chai and snack kiosks at campus events.', true)`;
  await sql`update fests set open_to_sponsors = true where slug in ('neon-utsav', 'kalaa-fest')`;
  const [{ id: chaiSponsor }] = await sql`select id from sponsors where email = 'brand@seed.thefest.in' and fest_id = ${festIds['neon-utsav']}`;
  const rq = (slug, brandUser, direction, brand, tier, amount, sentBy, status, more = {}) => sql`
    insert into sponsor_requests (fest_id, brand_user_id, direction, brand, tier, amount_paise, deliverables, message, status, reply, sent_by, decided_by, sponsor_id, created_at, decided_at)
    values (${festIds[slug]}, ${brandUser}, ${direction}, ${brand}, ${tier}, ${amount}, ${more.deliverables ?? null}, ${more.message ?? null}, ${status},
            ${more.reply ?? null}, ${sentBy}, ${status === 'sent' ? null : more.decidedBy ?? sentBy}, ${more.sponsorId ?? null},
            now() - interval '3 days', ${status === 'sent' ? null : sql`now() - interval '1 day'`})`;
  await rq('kalaa-fest', volt, 'brand_to_org', 'Volt Energy', 'Powered by', 12000000, volt, 'sent',
    { deliverables: 'Stall near the main stage, 4 emcee mentions, logo on passes', message: 'We would love to power the folk-fusion night.' });
  await rq('commerce-carnival', volt, 'org_to_brand', 'Volt Energy', 'Associate', 6000000, organizer2, 'sent',
    { deliverables: 'Stall at the quad, logo on the B-plan stage', message: '800 delegates from colleges across Bengaluru.' });
  await rq('neon-utsav', chai, 'brand_to_org', 'Chai Point Express', 'Associate', 10000000, chai, 'accepted',
    { deliverables: 'Two kiosks, one stage mention per night', decidedBy: organizer, sponsorId: chaiSponsor });
  await rq('hackverse', chai, 'org_to_brand', 'Chai Point Express', 'Partner', 3000000, organizer, 'declined',
    { message: '36 hours of hacking needs a lot of chai!', reply: 'Our budget for this quarter is used up.', decidedBy: chai });
  await rq('kalaa-fest', chai, 'brand_to_org', 'Chai Point Express', 'Partner', 2500000, chai, 'withdrawn', {});

  const [{ t }] = await sql`select count(*)::int as t from tickets`;
  console.log(`✓ Seeded ${FESTS.length} fests, ${crowd.length + 5} users, ${t} tickets`);
  console.log('  Demo logins (password123): student@ · organizer@ · sponsor@ · volunteer@ · admin@thefest.in');
} catch (e) {
  console.error('✗ Seed failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}

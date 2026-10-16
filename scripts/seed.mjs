// Seeds demo data: fictional fests, demo accounts, sales, scans, sponsors.
// Dates are relative to today, so the demo never looks out of date.
//
//   npm run db:seed            → only runs on an empty database
//   npm run db:seed -- --reset → WIPES ALL DATA first (local/dev only!)
//
// Demo logins (password: password123)
//   student@thefest.in · organizer@thefest.in · sponsor@thefest.in · volunteer@thefest.in
import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { loadEnv } from './env.mjs';

loadEnv();
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {}, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') ? false : 'require' });
const reset = process.argv.includes('--reset');

const day = (offset) => {
  const d = new Date(Date.now() + offset * 864e5);
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
    await sql`truncate email_verifications, payouts, upi_credits, fest_members, password_resets, email_outbox, sponsor_visits, sponsors, announcements, schedule_events, fest_staff, scans, tickets, orders, ticket_types, fests, sessions, users restart identity cascade`;
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
  await sql`update users set is_admin = true where id = ${admin}`;

  // ~120 attendees
  const crowd = [];
  for (let i = 0; i < 120; i++) {
    const nm = `${pick(FIRST)} ${pick(LAST)}`;
    crowd.push(await mkUser(`attendee${i + 1}@seed.thefest.in`, nm, 'student', pick(COLLEGES)));
  }

  const FESTS = [
    { slug: 'neon-utsav', org: organizer, name: 'Neon Utsav', college: COLLEGES[0], city: 'Bengaluru', venue: 'Main Grounds, Block A', category: 'cultural', s: -1, e: 1, emoji: '🎆', accent: '#FFE034', cap: 3000,
      desc: 'Three nights of pro shows, dance battles and an indie music stage. The flagship sample fest on THE FEST — explore it to see how everything works.',
      types: [['Day Pass', 'Entry for one day, all open events', 29900, 1200], ['3-Day Pass', 'All three days + pro night standing', 69900, 900], ['VIP Pro Night', 'Front pit for the headline act', 149900, 150]] },
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
    for (const [name, description, price, quota] of f.types) {
      const [t] = await sql`insert into ticket_types (fest_id, name, description, price_paise, quota, sort)
                            values (${row.id}, ${name}, ${description}, ${price}, ${quota}, ${sort++}) returning id, price_paise`;
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
  const staff = [
    ['volunteer@thefest.in', 'Kiran Volunteer', 'Gate 1'],
    ['organizer@thefest.in', 'Riya Kapoor', 'Gate 1'],
    ['gate2@seed.thefest.in', 'Manoj Gate', 'Gate 2'],
    ['gate3@seed.thefest.in', 'Priya Gate', 'Gate 3'],
    ['desk@seed.thefest.in', 'Lakshmi Desk', 'Registration desk'],
    ['stage@seed.thefest.in', 'Rahul Stage', 'Main stage'],
  ];
  for (const [i, [email, name, duty]] of staff.entries()) {
    await sql`insert into fest_staff (fest_id, email, name, duty, can_scan, checked_in_at)
              values (${festIds['neon-utsav']}, ${email}, ${name}, ${duty}, ${duty.startsWith('Gate')}, ${i < 4 ? at(0, 9, 10 * i) : null})`;
  }
  await sql`insert into fest_staff (fest_id, email, name, duty) values (${festIds['hackverse']}, 'volunteer@thefest.in', 'Kiran Volunteer', 'Gate 1')`;

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
  for (const u of crowd.slice(0, 74)) await sql`insert into sponsor_visits (sponsor_id, user_id, created_at) values (${s1}, ${u}, ${at(0, 10 + randomInt(9), randomInt(60))})`;
  for (const u of crowd.slice(0, 12)) await sql`insert into sponsor_visits (sponsor_id, user_id) values (${s2}, ${u})`;

  const [{ t }] = await sql`select count(*)::int as t from tickets`;
  console.log(`✓ Seeded ${FESTS.length} fests, ${crowd.length + 5} users, ${t} tickets`);
  console.log('  Demo logins (password123): student@ · organizer@ · sponsor@ · volunteer@ · admin@thefest.in');
} catch (e) {
  console.error('✗ Seed failed:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}

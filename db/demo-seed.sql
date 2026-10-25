-- ═══════════════════════════════════════════════════════════════
-- THE FEST — demo data for a PREVIEW database only (never production).
-- Same story as scripts/seed.mjs, written as plain SQL so it can be pasted
-- into the Supabase SQL editor. Every demo login uses the password: password123
-- Runs only on an empty database.
-- ═══════════════════════════════════════════════════════════════
do $$
declare
  pw text := '$2b$10$Thz73S7Aesh.phEeuIumc.QH9bSblPLPwe.Lece0mToqwzc4xohcy';  -- bcrypt('password123')
  colleges text[] := array['Demo Institute of Technology','Sample School of Design','Example College of Commerce','Placeholder University'];
  firsts text[] := array['Aarav','Diya','Rohan','Ananya','Karthik','Meera','Vikram','Sneha','Arjun','Kavya','Rahul','Ishita','Nikhil','Pooja','Siddharth','Tanvi','Aditya','Nandini','Varun','Shreya'];
  lasts text[] := array['Rao','Sharma','Iyer','Reddy','Nair','Gowda','Menon','Kulkarni','Hegde','Shetty','Patil','Bhat'];
  org1 uuid; org2 uuid; stu uuid; vol uuid; adm uuid;
  f_neon uuid; f_hack uuid; f_kalaa uuid; f_comm uuid; f_beats uuid; f_goal uuid;
  s1 uuid; s2 uuid; volt uuid; chai uuid; chai_s uuid;
  d0 date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if exists (select 1 from fests) then raise exception 'Database already has fests — demo seed is only for an empty preview database'; end if;

  insert into users (email, password_hash, name, role, college, email_verified_at) values ('organizer@thefest.in', pw, 'Riya Kapoor', 'organizer', colleges[1], now()) returning id into org1;
  insert into users (email, password_hash, name, role, college, email_verified_at) values ('organizer2@thefest.in', pw, 'Dev Malhotra', 'organizer', colleges[2], now()) returning id into org2;
  insert into users (email, password_hash, name, role, college, email_verified_at) values ('student@thefest.in', pw, 'Arjun Sharma', 'student', colleges[3], now()) returning id into stu;
  insert into users (email, password_hash, name, role, email_verified_at) values ('sponsor@thefest.in', pw, 'Neha Brand Manager', 'sponsor', now());
  insert into users (email, password_hash, name, role, college, email_verified_at) values ('volunteer@thefest.in', pw, 'Kiran Volunteer', 'student', colleges[1], now()) returning id into vol;
  insert into users (email, password_hash, name, role, is_admin, email_verified_at) values ('admin@thefest.in', pw, 'THE FEST Admin', 'organizer', true, now()) returning id into adm;
  insert into users (email, password_hash, name, role, college, email_verified_at) values
    ('lunch@seed.thefest.in', pw, 'Lata Lunch', 'student', colleges[1], now()), ('stay@seed.thefest.in', pw, 'Sunil Stay', 'student', colleges[1], now()),
    -- every seeded role holder can log in (only newvolunteer@ stays "no account yet")
    ('gate2@seed.thefest.in', pw, 'Manoj Gate', 'student', colleges[1], now()), ('gate3@seed.thefest.in', pw, 'Priya Gate', 'student', colleges[1], now()),
    ('desk@seed.thefest.in', pw, 'Lakshmi Desk', 'student', colleges[1], now()), ('stage@seed.thefest.in', pw, 'Rahul Stage', 'student', colleges[1], now());

  -- 120 attendees
  insert into users (email, password_hash, name, role, college, email_verified_at)
  select 'attendee' || g || '@seed.thefest.in', pw,
         firsts[1 + (g * 7) % 20] || ' ' || lasts[1 + (g * 5) % 12], 'student', colleges[1 + (g * 3) % 4], now()
  from generate_series(1, 120) g;

  -- Fests (dates relative to today, IST)
  insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
  values ('neon-utsav', org1, 'Neon Utsav', colleges[1], 'Bengaluru', 'Main Grounds, Block A', 'cultural', d0 - 1, d0 + 1,
          'Three nights of pro shows, dance battles and an indie music stage. The flagship sample fest on THE FEST — explore it to see how everything works.', '🎆', '#FFE034', 3000, 'live', now())
  returning id into f_neon;
  insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
  values ('hackverse', org1, 'Hackverse 36', colleges[1], 'Bengaluru', 'Innovation Centre', 'tech', d0 + 12, d0 + 13,
          'A 36-hour student hackathon with workshops, mentor hours and ₹2L in prizes. Sample data.', '🚀', '#38BDF8', 600, 'live', now())
  returning id into f_hack;
  insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
  values ('kalaa-fest', org2, 'Kalaa', colleges[2], 'Mysuru', 'Open Air Theatre', 'cultural', d0 + 21, d0 + 23,
          'Art, design and performance — street art walls, a fashion show and a folk-fusion night. Sample data.', '🎨', '#FF5C1A', 2000, 'live', now())
  returning id into f_kalaa;
  insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
  values ('commerce-carnival', org2, 'Commerce Carnival', colleges[3], 'Bengaluru', 'Auditorium & Quad', 'management', d0 + 34, d0 + 35,
          'B-plan battles, a mock stock exchange and the best-manager hunt. Sample data.', '📈', '#00E5A0', 1200, 'live', now())
  returning id into f_comm;
  insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
  values ('campus-beats', org2, 'Campus Beats', colleges[4], 'Bengaluru', 'Amphitheatre', 'cultural', d0 + 45, d0 + 46,
          'Battle of the bands and a DJ night. Waiting for THE FEST approval — sample data.', '🎤', '#B794F6', 1500, 'review', null)
  returning id into f_beats;
  insert into fests (slug, organizer_id, name, college, city, venue, category, starts_on, ends_on, description, emoji, accent, capacity, status, approved_at)
  values ('goal-rush', org1, 'Goal Rush', colleges[4], 'Bengaluru', 'Sports Complex', 'sports', d0 - 40, d0 - 38,
          'Inter-college football and futsal. This one already happened — sample data.', '⚽', '#FF2D55', 1000, 'ended', now())
  returning id into f_goal;

  insert into ticket_types (fest_id, name, description, price_paise, quota, sort) values
    (f_neon, 'Day Pass', 'Entry for one day, all open events', 29900, 1200, 0),
    (f_neon, '3-Day Pass', 'All three days + pro night standing, lunch on days 2–3 and hostel stay', 69900, 900, 1),
    (f_neon, 'VIP Pro Night', 'Front pit for the headline act', 149900, 150, 2),
    (f_hack, 'Hacker (team member)', 'One seat in a team of up to 4', 0, 400, 0),
    (f_hack, 'Workshop Pass', 'All workshops, no hacking', 19900, 200, 1),
    (f_kalaa, 'General', 'All days, all stages', 39900, 1500, 0),
    (f_kalaa, 'Workshop Bundle', 'General + 3 art workshops', 79900, 120, 1),
    (f_comm, 'Delegate', 'All events + lunch', 49900, 800, 0),
    (f_beats, 'Entry', 'Both days', 19900, 1000, 0),
    (f_goal, 'Spectator', 'All matches', 9900, 900, 0);
  -- Lunch / stay (scanner counters): the 3-Day Pass includes lunch on days 2–3 and stay; lunch is also sold as an add-on
  update ticket_types set lunch_days = array[d0, d0 + 1], includes_stay = true where fest_id = f_neon and name = '3-Day Pass';
  insert into ticket_types (fest_id, name, description, price_paise, quota, sort, kind, lunch_days)
  values (f_neon, 'Lunch add-on', 'Lunch on days 2–3', 9900, 500, 3, 'addon', array[d0, d0 + 1]);

  -- Sales: one order per (attendee, fest), spread over past days. Fee ₹15 per paid ticket.
  create temp table plan (n int, buyer uuid, fest uuid, sort int, qty int, days_ago numeric) on commit drop;
  insert into plan
  select n, u.id, f_neon, case when n % 7 = 0 then 2 when n % 3 = 0 then 1 else 0 end, case when n % 9 = 0 then 2 else 1 end, (n * 37 % 21) + (n * 13 % 20) / 24.0
  from (select id, row_number() over (order by email) - 1 as n from users where email like 'attendee%') u;
  insert into plan select n, buyer, f_hack, n % 2, 1, (n * 11 % 10) + 0.3 from plan where fest = f_neon and n < 45;
  insert into plan select n, buyer, f_kalaa, case when n % 10 < 8 then 0 else 1 end, 1, (n * 5 % 14) + 0.5 from plan where fest = f_neon and n between 40 and 94;
  insert into plan select n, buyer, f_comm, 0, 1, (n * 3 % 7) + 0.2 from plan where fest = f_neon and n between 60 and 89;
  insert into plan select n, buyer, f_goal, 0, 1, 45 + (n % 10) from plan where fest = f_neon and n < 70;
  insert into plan values (900, stu, f_neon, 1, 1, 3), (901, stu, f_hack, 0, 1, 1);

  insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, status, provider, created_at, paid_at)
  select p.buyer, p.fest, tt.id, p.qty,
         tt.price_paise * p.qty + case when tt.price_paise > 0 then 1500 * p.qty else 0 end,
         case when tt.price_paise > 0 then 1500 * p.qty else 0 end,
         'paid', case when tt.price_paise > 0 then 'demo' else 'free' end,
         now() - (p.days_ago || ' days')::interval, now() - (p.days_ago || ' days')::interval
  from plan p join ticket_types tt on tt.fest_id = p.fest and tt.sort = p.sort;

  insert into tickets (code, order_id, user_id, fest_id, ticket_type_id, holder_name, issued_at)
  select 'TF-' || upper(substr(md5(o.id::text || k), 1, 4)) || '-' || upper(substr(md5(o.id::text || k), 5, 4)),
         o.id, o.user_id, o.fest_id, o.ticket_type_id,
         case when o.qty > 1 then u.name || ' (' || k || '/' || o.qty || ')' else u.name end, o.paid_at
  from orders o join users u on u.id = o.user_id cross join lateral generate_series(1, o.qty) k;

  update ticket_types tt set sold = (select count(*) from tickets t where t.ticket_type_id = tt.id);

  -- Team & Roles (v2.7): gate team plus role holders on normal student accounts
  insert into fest_roles (fest_id, email, name, role, duty, can_scan, checked_in_at, added_by) values
    (f_neon, 'volunteer@thefest.in', 'Kiran Volunteer', 'vol_gate', 'Gate 1', true, now() - interval '5 hours', org1),
    (f_neon, 'organizer@thefest.in', 'Riya Kapoor', 'vol_gate', 'Gate 1', true, now() - interval '5 hours', org1),
    (f_neon, 'gate2@seed.thefest.in', 'Manoj Gate', 'vol_gate', 'Gate 2', true, now() - interval '4 hours', org1),
    (f_neon, 'gate3@seed.thefest.in', 'Priya Gate', 'vol_gate', 'Gate 3', true, now() - interval '4 hours', org1),
    (f_neon, 'desk@seed.thefest.in', 'Lakshmi Desk', 'desk', 'Registration desk', true, null, org1),
    (f_neon, 'stage@seed.thefest.in', 'Rahul Stage', 'vol_gate', 'Main stage', false, null, org1),
    (f_neon, 'lunch@seed.thefest.in', 'Lata Lunch', 'vol_lunch', 'Lunch counter', true, null, org1),
    (f_neon, 'stay@seed.thefest.in', 'Sunil Stay', 'vol_stay', 'Stay desk', true, null, org1),
    (f_hack, 'volunteer@thefest.in', 'Kiran Volunteer', 'vol_gate', 'Gate 1', true, null, org1);
  insert into users (email, password_hash, name, role, college, email_verified_at) values
    ('cohost@seed.thefest.in', pw, 'Chetan Cohost', 'student', colleges[1], now()),
    ('finance@seed.thefest.in', pw, 'Farah Finance', 'student', colleges[1], now()),
    ('sponsorlead@seed.thefest.in', pw, 'Sameer Sponsorship', 'student', colleges[1], now()),
    ('media@seed.thefest.in', pw, 'Meera Media', 'student', colleges[1], now()),
    ('eventhead@seed.thefest.in', pw, 'Esha Events', 'student', colleges[1], now()),
    ('judge@seed.thefest.in', pw, 'Jai Judge', 'student', colleges[1], now());
  insert into fest_roles (fest_id, email, name, role, scope_label, scope_day, added_by) values
    (f_neon, 'cohost@seed.thefest.in', 'Chetan Cohost', 'co_organizer', null, null, org1),
    (f_neon, 'finance@seed.thefest.in', 'Farah Finance', 'finance', null, null, org1),
    (f_neon, 'sponsorlead@seed.thefest.in', 'Sameer Sponsorship', 'sponsorship', null, null, org1),
    (f_neon, 'media@seed.thefest.in', 'Meera Media', 'media', null, null, org1),
    (f_neon, 'media@seed.thefest.in', 'Meera Media', 'judge', 'Battle of Bands', null, org1),
    (f_neon, 'eventhead@seed.thefest.in', 'Esha Events', 'event_head', 'Battle of Bands', null, org1),
    (f_neon, 'judge@seed.thefest.in', 'Jai Judge', 'judge', 'Fashion Show', d0 + 1, org1),
    (f_neon, 'newvolunteer@seed.thefest.in', 'Nisha New', 'vol_gate', null, null, org1);   -- pending: no account yet
  insert into fest_activity (fest_id, actor_id, actor_email, actor_role, action, summary) values
    (f_neon, org1, 'organizer@thefest.in', 'owner', 'role.add', 'Added Farah Finance as Finance lead'),
    (f_neon, org1, 'organizer@thefest.in', 'owner', 'role.add', 'Added Meera Media as Media / PR');

  -- Check-ins: ~62% of Neon Utsav tickets today 9 AM–6 PM IST; most Goal Rush tickets
  with c as (
    select t.id, row_number() over (order by t.code) as r, count(*) over () as total
    from tickets t where t.fest_id = f_neon and t.user_id <> stu
  ), chosen as (
    select id, r, (d0::timestamp + make_interval(hours => 9 + (r * 7 % 9)::int, mins => (r * 17 % 60)::int)) at time zone 'Asia/Kolkata' as at_
    from c where r <= total * 0.62
  ), upd as (
    update tickets t set status = 'used', checked_in_at = ch.at_, checked_in_by = vol, gate = 'Gate ' || (1 + ch.r % 3)
    from chosen ch where t.id = ch.id returning t.id, t.fest_id, t.gate, t.checked_in_at
  )
  insert into scans (fest_id, ticket_id, scanned_by, gate, result, created_at) select fest_id, id, vol, gate, 'admitted', checked_in_at from upd;

  with c as (
    select t.id, row_number() over (order by t.code) as r from tickets t where t.fest_id = f_goal
  ), upd as (
    update tickets t set status = 'used', checked_in_by = vol, gate = 'Gate ' || (1 + c.r % 3),
      checked_in_at = ((d0 - 40)::timestamp + make_interval(hours => 10 + (c.r * 5 % 6)::int, mins => (c.r * 13 % 60)::int)) at time zone 'Asia/Kolkata'
    from c where t.id = c.id and c.r <= 64 returning t.id, t.fest_id, t.gate, t.checked_in_at
  )
  insert into scans (fest_id, ticket_id, scanned_by, gate, result, created_at) select fest_id, id, vol, gate, 'admitted', checked_in_at from upd;

  insert into scans (fest_id, ticket_id, scanned_by, gate, result, detail, created_at)
  select f_neon, t.id, vol, 'Gate ' || (1 + r % 3), 'duplicate', 'Already used', (d0::timestamp + make_interval(hours => 12 + r::int, mins => 5)) at time zone 'Asia/Kolkata'
  from (select id, row_number() over (order by checked_in_at) - 1 as r from tickets where fest_id = f_neon and status = 'used' limit 6) t;
  insert into scans (fest_id, scanned_by, gate, result, detail, created_at)
  select f_neon, vol, 'Gate ' || g, 'invalid', 'Signature check failed', (d0::timestamp + make_interval(hours => 12 + g, mins => 20)) at time zone 'Asia/Kolkata'
  from generate_series(1, 3) g;

  -- Schedule
  insert into schedule_events (fest_id, title, venue, category, starts_at, ends_at)
  select f_neon, title, venue, cat,
         ((d0 + d)::timestamp + make_interval(hours => s)) at time zone 'Asia/Kolkata',
         ((d0 + d)::timestamp + make_interval(hours => e)) at time zone 'Asia/Kolkata'
  from (values (-1,10,12,'Inauguration & Lamp Lighting','Main Stage','ceremony'), (-1,14,17,'Battle of Bands — Prelims','Indie Stage','music'),
               (-1,19,22,'Bollywood Night','Main Grounds','pro-show'), (0,10,13,'Street Dance Battle','Quad','dance'),
               (0,11,13,'Treasure Hunt','Campus-wide','fun'), (0,14,16,'Open Mic','Indie Stage','music'),
               (0,16,18,'Fashion Walk','Main Stage','fashion'), (0,19,23,'EDM Pro Night','Main Grounds','pro-show'),
               (1,10,12,'Quiz — Finals','Auditorium','quiz'), (1,13,16,'Battle of Bands — Finals','Indie Stage','music'),
               (1,19,22,'Headliner Concert','Main Grounds','pro-show')) v(d, s, e, title, venue, cat);
  insert into schedule_events (fest_id, title, venue, starts_at, ends_at)
  select f_hack, title, venue,
         ((d0 + d)::timestamp + make_interval(hours => s)) at time zone 'Asia/Kolkata',
         ((d0 + d)::timestamp + make_interval(hours => e)) at time zone 'Asia/Kolkata'
  from (values (12,9,10,'Check-in & Breakfast','Lobby'), (12,10,11,'Opening Keynote','Hall A'), (12,11,23,'Hacking — Round 1','Labs'),
               (13,10,13,'Final Demos','Hall A'), (13,15,16,'Prize Ceremony','Hall A')) v(d, s, e, title, venue);

  -- Announcements
  insert into announcements (fest_id, title, body, urgent, created_at) values
    (f_neon, 'Gate 2 is crowded', 'Please use Gate 3 near the parking lot — shorter queue.', true, (d0::timestamp + interval '17 hours 40 minutes') at time zone 'Asia/Kolkata'),
    (f_neon, 'EDM Pro Night starts 7 PM', 'Gates to the Main Grounds open at 6:15. Carry your QR pass.', false, (d0::timestamp + interval '12 hours') at time zone 'Asia/Kolkata'),
    (f_neon, 'Welcome to Neon Utsav!', 'Food court is at Block C. Water stations at every gate.', false, ((d0 - 1)::timestamp + interval '9 hours') at time zone 'Asia/Kolkata'),
    (f_hack, 'Team registrations close soon', 'Lock your team of up to 4 before the event week.', false, ((d0 - 1)::timestamp + interval '18 hours') at time zone 'Asia/Kolkata');

  -- Sponsors (fictional brands); sponsor@thefest.in sees Volt Energy
  insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values (f_neon, 'sponsor@thefest.in', 'Volt Energy', 'Title', 50000000, encode(gen_random_bytes(9), 'hex')) returning id into s1;
  insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values (f_hack, 'sponsor@thefest.in', 'Volt Energy', 'Powered by', 15000000, encode(gen_random_bytes(9), 'hex')) returning id into s2;
  insert into sponsors (fest_id, email, brand, tier, amount_paise, booth_code) values
    (f_neon, 'brand@seed.thefest.in', 'Chai Point Express', 'Associate', 10000000, encode(gen_random_bytes(9), 'hex')),
    (f_neon, 'brand2@seed.thefest.in', 'PixelPhone', 'Partner', 7500000, encode(gen_random_bytes(9), 'hex'));
  insert into sponsor_visits (sponsor_id, user_id, created_at)
  -- never in the future: a time later than now moves to yesterday (fest day 1)
  select s1, id, case when t < now() - interval '5 minutes' then t else t - interval '1 day' end
  from (select id, (d0::timestamp + make_interval(hours => 10 + (r * 7 % 9)::int, mins => (r * 23 % 60)::int)) at time zone 'Asia/Kolkata' as t
        from (select id, row_number() over (order by email) as r from users where email like 'attendee%') u where r <= 74) x;
  insert into sponsor_visits (sponsor_id, user_id)
  select s2, id from (select id, row_number() over (order by email) as r from users where email like 'attendee%') u where r <= 12;
  -- Sample leads (needs v2.5): 10 booth visitors chose to share with Volt Energy at Neon Utsav; one later stopped sharing.
  insert into sponsor_leads (sponsor_id, user_id, name, email, college, course_year, notice_version, shared_at, withdrawn_at)
  select s1, u.id, case when r < 10 then u.name end, u.email, case when r < 10 then u.college end,
         case when r < 10 then (array['B.E. CSE, 3rd year','B.Com, 2nd year','B.Des, final year',null,'MBA, 1st year'])[1 + (r % 5)::int] end,
         'lead-v1', least(v.created_at + interval '1 minute', now()), case when r = 10 then least(v.created_at + interval '2 hours', now()) end
  from (select id, name, email, college, row_number() over (order by email) as r from users where email like 'attendee%') u
  join sponsor_visits v on v.sponsor_id = s1 and v.user_id = u.id
  where r <= 10;
  -- Sponsorship requests (needs v2.6): two listed brands, two fests open to brands, requests both ways in each status.
  select id into volt from users where email = 'sponsor@thefest.in';
  insert into users (email, password_hash, name, role, email_verified_at) values ('brand@seed.thefest.in', pw, 'Kabir Chai Point', 'sponsor', now()) returning id into chai;
  insert into brand_profiles (user_id, brand, category, budget_min_paise, budget_max_paise, cities, about, listed) values
    (volt, 'Volt Energy', 'food', 5000000, 50000000, '{Bengaluru,Mysuru}', 'Energy drinks for students who stay up for the pro night.', true),
    (chai, 'Chai Point Express', 'food', 2500000, 15000000, '{Bengaluru}', 'Chai and snack kiosks at campus events.', true);
  update fests set open_to_sponsors = true where id in (f_neon, f_kalaa);
  select id into chai_s from sponsors where email = 'brand@seed.thefest.in' and fest_id = f_neon;
  insert into sponsor_requests (fest_id, brand_user_id, direction, brand, tier, amount_paise, deliverables, message, status, reply, sent_by, decided_by, sponsor_id, created_at, decided_at) values
    (f_kalaa, volt, 'brand_to_org', 'Volt Energy', 'Powered by', 12000000, 'Stall near the main stage, 4 emcee mentions, logo on passes', 'We would love to power the folk-fusion night.', 'sent', null, volt, null, null, now() - interval '3 days', null),
    (f_comm, volt, 'org_to_brand', 'Volt Energy', 'Associate', 6000000, 'Stall at the quad, logo on the B-plan stage', '800 delegates from colleges across Bengaluru.', 'sent', null, org2, null, null, now() - interval '3 days', null),
    (f_neon, chai, 'brand_to_org', 'Chai Point Express', 'Associate', 10000000, 'Two kiosks, one stage mention per night', null, 'accepted', null, chai, org1, chai_s, now() - interval '3 days', now() - interval '1 day'),
    (f_hack, chai, 'org_to_brand', 'Chai Point Express', 'Partner', 3000000, null, '36 hours of hacking needs a lot of chai!', 'declined', 'Our budget for this quarter is used up.', org1, chai, null, now() - interval '3 days', now() - interval '1 day'),
    (f_kalaa, chai, 'brand_to_org', 'Chai Point Express', 'Partner', 2500000, null, null, 'withdrawn', null, chai, chai, null, now() - interval '3 days', now() - interval '1 day');
end $$;

-- v2.8 events demo (needs v2.8; scripts/seed.mjs runs this same block). Neon Utsav: a solo free event, a solo paid
-- event, a paid team event that allows mixed colleges (one paid team, one still forming), a nearly full event, a closed
-- one, and the events the seeded Event head / Judges are linked to.
do $$
declare
  f uuid := (select id from fests where slug = 'neon-utsav');
  d0 date := (now() at time zone 'Asia/Kolkata')::date;
  ev uuid; reg uuid;
  u uuid; i int;
  fee int := 500;   -- ₹5 platform fee per paid entry
begin
  if f is null or exists (select 1 from events where fest_id = f) then return; end if;
  -- name, category, day, hour, venue, team_min, team_max, price (paise), slots, deadline (hours from day start, null = start), mixed, needs_ticket, rules, prize
  create temp table _ev (k text, title text, cat text, d int, h int, venue text, tmin int, tmax int, price int, slots int, dl_day int, dl_h int, mixed bool, needs bool, rules text, prize text) on commit drop;
  insert into _ev values
    ('sing', 'Solo Singing', 'cultural', 1, 11, 'Indie Stage', 1, 1, 0, 40, 1, 10, true, false, 'One song, up to 5 minutes. Karaoke tracks allowed.', 'Trophy + ₹5,000'),
    ('standup', 'Stand-up Comedy Open', 'literary', 1, 15, 'Seminar Hall', 1, 1, 10000, 20, 1, 12, true, true, 'Clean sets only, 6 minutes each.', '₹10,000'),
    ('bands', 'Battle of Bands', 'cultural', 1, 13, 'Indie Stage', 3, 6, 50000, 12, 1, 9, true, true, 'Original compositions score higher. 20 minutes per band including setup.', '₹25,000 + studio session'),
    ('bgmi', 'BGMI Showdown', 'gaming', 1, 10, 'Lab Block 2', 1, 1, 0, 8, 1, 8, true, false, 'Bring your own phone. Squad rules announced at the venue.', 'Gaming headsets'),
    ('case', 'Case Study Challenge', 'management', 1, 10, 'Seminar Hall', 2, 4, 0, 10, 1, 8, false, false, 'Teams from one college. 10-minute pitch + 5 minutes Q&A.', '₹15,000'),
    ('fashion', 'Fashion Show', 'cultural', 1, 17, 'Main Stage', 4, 8, 0, 15, 1, 12, true, false, 'Theme: Neon Nights. 6 minutes per team.', '₹20,000'),
    ('hunt', 'Treasure Hunt', 'sports', 0, 11, 'Campus-wide', 2, 4, 0, 30, -1, 20, true, false, 'Clues every 15 minutes.', 'Goodies');
  insert into ticket_types (fest_id, name, description, price_paise, quota, sold, sort, kind)
    select f, 'Event: ' || title, '', price, slots, 0, 1000, 'event' from _ev;
  insert into events (fest_id, category, title, starts_at, venue, rules, prize, team_min, team_max, price_paise, slots, reg_deadline, mixed_colleges, needs_ticket, ticket_type_id)
    select f, x.cat, x.title, ((d0 + x.d)::timestamp + make_interval(hours => x.h)) at time zone 'Asia/Kolkata', x.venue, x.rules, x.prize, x.tmin, x.tmax, x.price, x.slots,
           ((d0 + x.dl_day)::timestamp + make_interval(hours => x.dl_h)) at time zone 'Asia/Kolkata', x.mixed, x.needs, t.id
    from _ev x join ticket_types t on t.fest_id = f and t.kind = 'event' and t.name = 'Event: ' || x.title;

  -- Solo Singing: 5 confirmed; BGMI: 7 of 8 (nearly full); Fashion Show: none yet
  for i in 1..12 loop
    select id into u from users where email = 'attendee' || (20 + i) || '@seed.thefest.in';
    select id into ev from events where fest_id = f and title = case when i <= 5 then 'Solo Singing' else 'BGMI Showdown' end;
    insert into event_regs (event_id, fest_id, captain_id, status, confirmed_at, created_at) values (ev, f, u, 'confirmed', now() - make_interval(hours => i), now() - make_interval(hours => i)) returning id into reg;
    insert into event_members (reg_id, event_id, email, user_id, status, invited_at, joined_at) select reg, ev, email, id, 'joined', now() - make_interval(hours => i), now() - make_interval(hours => i) from users where id = u;
  end loop;

  -- Stand-up (₹100 + ₹5, needs a fest ticket): two paid entries by ticket holders, one marked present
  select id into ev from events where fest_id = f and title = 'Stand-up Comedy Open';
  for u in select t.user_id from tickets t join users x on x.id = t.user_id
           where t.fest_id = f and t.status <> 'void' and x.email like 'attendee%' group by t.user_id order by min(x.email) limit 2 loop
    insert into event_regs (event_id, fest_id, captain_id, status, confirmed_at) values (ev, f, u, 'confirmed', now() - interval '3 hours') returning id into reg;
    insert into event_members (reg_id, event_id, email, user_id, status, joined_at) select reg, ev, email, id, 'joined', now() - interval '3 hours' from users where id = u;
    insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, gateway_fee_paise, provider, method, status, paid_at, created_at, registration_id)
      select u, f, e.ticket_type_id, 1, 10000 + fee + ceil((10000 + fee) * 0.0236 / (1 - 0.0236))::int, fee, ceil((10000 + fee) * 0.0236 / (1 - 0.0236))::int,
             'demo', 'gateway', 'paid', now() - interval '3 hours', now() - interval '3 hours', reg from events e where e.id = ev;
  end loop;
  update event_members set checked_in_at = now() - interval '20 minutes'
    where id = (select m.id from event_members m where m.event_id = ev order by m.joined_at, m.id limit 1);

  -- Battle of Bands (₹500 per team + ₹5, mixed colleges, needs a fest ticket): one paid team of 4, one team forming (2 joined + 1 invite)
  select id into ev from events where fest_id = f and title = 'Battle of Bands';
  create temp table _band on commit drop as
    select t.user_id, min(x.email) as email from tickets t join users x on x.id = t.user_id
    where t.fest_id = f and t.status <> 'void' and x.email like 'attendee%'
      and not exists (select 1 from event_members m where m.user_id = t.user_id and m.event_id = ev)
    group by t.user_id order by min(x.email) desc limit 6;
  insert into event_regs (event_id, fest_id, captain_id, team_name, status, confirmed_at)
    values (ev, f, (select user_id from _band order by email limit 1), 'The Neon Riffs', 'confirmed', now() - interval '1 day') returning id into reg;
  insert into event_members (reg_id, event_id, email, user_id, status, joined_at)
    select reg, ev, b.email, b.user_id, 'joined', now() - interval '1 day' from (select * from _band order by email limit 4) b;
  insert into orders (user_id, fest_id, ticket_type_id, qty, amount_paise, platform_fee_paise, gateway_fee_paise, provider, method, status, paid_at, created_at, registration_id)
    select (select user_id from _band order by email limit 1), f, e.ticket_type_id, 1, 50000 + fee + ceil((50000 + fee) * 0.0236 / (1 - 0.0236))::int, fee,
           ceil((50000 + fee) * 0.0236 / (1 - 0.0236))::int, 'demo', 'gateway', 'paid', now() - interval '1 day', now() - interval '1 day', reg from events e where e.id = ev;
  insert into event_regs (event_id, fest_id, captain_id, team_name, status)
    values (ev, f, (select user_id from _band order by email offset 4 limit 1), 'Bass Drop Crew', 'forming') returning id into reg;
  insert into event_members (reg_id, event_id, email, user_id, status, joined_at)
    select reg, ev, b.email, b.user_id, 'joined', now() - interval '2 hours' from (select * from _band order by email offset 4 limit 2) b;
  insert into event_members (reg_id, event_id, email, user_id, status) values (reg, ev, 'newbandmate@seed.thefest.in', null, 'invited');

  -- Slot counters = confirmed entries
  update ticket_types t set sold = (select count(*) from event_regs r join events e on e.id = r.event_id where e.ticket_type_id = t.id and r.status = 'confirmed')
    where t.fest_id = f and t.kind = 'event';
  -- The seeded Event head and Judges work their events
  update fest_roles r set event_id = e.id, scope_label = e.title from events e
    where r.fest_id = f and e.fest_id = f and r.role in ('event_head', 'judge') and r.scope_label = e.title;
end $$;

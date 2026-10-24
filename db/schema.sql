-- ═══════════════════════════════════════════════════════════════
-- THE FEST — database schema (PostgreSQL 15+ / Supabase)
-- Run once: Supabase → SQL Editor → paste this file → Run.
-- Safe to re-run: every statement is idempotent.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ─── Types ─────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('student', 'organizer', 'sponsor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fest_status as enum ('draft', 'live', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending', 'paid', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_status as enum ('valid', 'used', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_result as enum ('admitted', 'duplicate', 'invalid', 'wrong_fest', 'void');
exception when duplicate_object then null; end $$;

-- ─── Users & sessions ──────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  password_hash text   not null,
  name          text   not null,
  phone         text,
  college       text,
  role          user_role not null,          -- picked once at signup
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  token_hash  text primary key,               -- sha256 of the cookie token
  user_id     uuid not null references users(id) on delete cascade,
  kind        text not null default 'app' check (kind in ('app', 'scanner')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

-- ─── Fests ─────────────────────────────────────────────────────
create table if not exists fests (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  organizer_id  uuid not null references users(id) on delete restrict,
  name          text not null,
  college       text not null,
  city          text not null,
  venue         text,
  category      text not null default 'cultural', -- cultural | tech | sports | management | other
  starts_on     date not null,
  ends_on       date not null,
  description   text not null default '',
  emoji         text not null default '🎉',
  accent        text not null default '#FFE034',
  capacity      int  check (capacity is null or capacity > 0),
  status        fest_status not null default 'draft',
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists fests_status_idx on fests(status, starts_on);
create index if not exists fests_organizer_idx on fests(organizer_id);

create table if not exists ticket_types (
  id          uuid primary key default gen_random_uuid(),
  fest_id     uuid not null references fests(id) on delete cascade,
  name        text not null,
  description text not null default '',
  price_paise int  not null check (price_paise >= 0),
  quota       int  not null check (quota > 0),
  sold        int  not null default 0 check (sold >= 0),
  sort        int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (sold <= quota)
);
create index if not exists ticket_types_fest_idx on ticket_types(fest_id);

-- ─── Orders & tickets ──────────────────────────────────────────
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete restrict,
  fest_id             uuid not null references fests(id) on delete restrict,
  ticket_type_id      uuid not null references ticket_types(id) on delete restrict,
  qty                 int  not null check (qty between 1 and 10),
  amount_paise        int  not null check (amount_paise >= 0),   -- what the student pays
  platform_fee_paise  int  not null default 0,                    -- THE FEST commission
  status              order_status not null default 'pending',
  provider            text not null default 'demo' check (provider in ('razorpay', 'demo', 'free')),
  razorpay_order_id   text unique,
  razorpay_payment_id text unique,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index if not exists orders_fest_idx on orders(fest_id, status);
create index if not exists orders_user_idx on orders(user_id);

create table if not exists tickets (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                 -- short human code, e.g. TF-7K2M-QX9P
  order_id        uuid not null references orders(id) on delete cascade,
  user_id         uuid not null references users(id) on delete restrict,
  fest_id         uuid not null references fests(id) on delete restrict,
  ticket_type_id  uuid not null references ticket_types(id) on delete restrict,
  holder_name     text not null,
  status          ticket_status not null default 'valid',
  issued_at       timestamptz not null default now(),
  checked_in_at   timestamptz,
  checked_in_by   uuid references users(id),
  gate            text
);
create index if not exists tickets_fest_idx on tickets(fest_id, status);
create index if not exists tickets_user_idx on tickets(user_id);

create table if not exists scans (
  id          bigserial primary key,
  fest_id     uuid not null references fests(id) on delete cascade,
  ticket_id   uuid references tickets(id) on delete set null,
  scanned_by  uuid not null references users(id),
  gate        text,
  result      scan_result not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists scans_fest_idx on scans(fest_id, created_at desc);

-- ─── Staff (volunteers / gate scanners) ────────────────────────
-- Volunteers are invited by email; they sign up with any role and
-- gain scanner access for that fest.
create table if not exists fest_staff (
  id             uuid primary key default gen_random_uuid(),
  fest_id        uuid not null references fests(id) on delete cascade,
  email          citext not null,
  name           text not null,
  duty           text not null default 'Gate',       -- Gate 1, Registration desk, Stage…
  can_scan       boolean not null default true,
  checked_in_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (fest_id, email)
);

-- ─── Schedule & announcements ──────────────────────────────────
create table if not exists schedule_events (
  id          uuid primary key default gen_random_uuid(),
  fest_id     uuid not null references fests(id) on delete cascade,
  title       text not null,
  venue       text not null default '',
  category    text not null default 'event',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists schedule_fest_idx on schedule_events(fest_id, starts_at);

create table if not exists announcements (
  id          uuid primary key default gen_random_uuid(),
  fest_id     uuid not null references fests(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  urgent      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists announcements_fest_idx on announcements(fest_id, created_at desc);

-- ─── Sponsors ──────────────────────────────────────────────────
create table if not exists sponsors (
  id            uuid primary key default gen_random_uuid(),
  fest_id       uuid not null references fests(id) on delete cascade,
  email         citext not null,                     -- sponsor user who can see the dashboard
  brand         text not null,
  tier          text not null default 'Associate',   -- Title | Powered by | Associate | Partner
  amount_paise  int  not null default 0 check (amount_paise >= 0),
  booth_code    text not null unique,                -- printed as QR at the booth
  created_at    timestamptz not null default now(),
  unique (fest_id, email, brand)
);

create table if not exists sponsor_visits (
  id          bigserial primary key,
  sponsor_id  uuid not null references sponsors(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (sponsor_id, user_id)
);

-- ─── Security note ─────────────────────────────────────────────
-- The app talks to Postgres only from the server (DATABASE_URL), never
-- from the browser. Enable RLS with no policies so Supabase's public
-- REST API (anon key) cannot read or write these tables.
alter table users            enable row level security;
alter table sessions         enable row level security;
alter table fests            enable row level security;
alter table ticket_types     enable row level security;
alter table orders           enable row level security;
alter table tickets          enable row level security;
alter table scans            enable row level security;
alter table fest_staff       enable row level security;
alter table schedule_events  enable row level security;
alter table announcements    enable row level security;
alter table sponsors         enable row level security;
alter table sponsor_visits   enable row level security;

-- ═══════════════════════════════════════════════════════════════
-- v2 (Oct 2026): payments (Cashfree + zero-fee bank UPI), admin approval,
-- refunds, password reset, ticket transfer, co-organizers, payouts.
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════
alter type fest_status add value if not exists 'review';     -- waiting for THE FEST approval
alter type fest_status add value if not exists 'cancelled';
alter type order_status add value if not exists 'refunded';

alter table users add column if not exists is_admin boolean not null default false;

alter table fests add column if not exists upi_enabled   boolean not null default false;
alter table fests add column if not exists upi_vpa       text;           -- e.g. fest@icici (fest's own bank account)
alter table fests add column if not exists upi_name      text;           -- payee name shown in the UPI app
alter table fests add column if not exists inbound_token text unique;   -- secret for forwarding bank alert emails
alter table fests add column if not exists approved_at   timestamptz;
alter table fests add column if not exists approved_by   uuid references users(id);
alter table fests add column if not exists review_note   text;           -- admin's note when sending back
alter table fests add column if not exists cancelled_reason text;

alter table orders add column if not exists method            text not null default 'gateway';  -- gateway | upi_direct | free
alter table orders add column if not exists gateway_fee_paise int  not null default 0;
alter table orders add column if not exists provider_order_id text;     -- Cashfree order id
alter table orders add column if not exists payment_ref       text;     -- gateway payment id
alter table orders add column if not exists utr               text;     -- UPI reference typed by student
alter table orders add column if not exists utr_submitted_at  timestamptz;
alter table orders add column if not exists verify_source     text;     -- statement | email | paste | manual
alter table orders add column if not exists review_flag       text;     -- why an order needs a human look
alter table orders add column if not exists refunded_paise    int  not null default 0;
alter table orders add column if not exists refunded_at       timestamptz;
alter table orders add column if not exists refund_note       text;
alter table orders drop constraint if exists orders_provider_check;
alter table orders add constraint orders_provider_check
  check (provider in ('razorpay', 'cashfree', 'demo', 'free', 'upi_direct'));
create unique index if not exists orders_utr_uniq on orders(utr) where utr is not null;
create unique index if not exists orders_provider_order_uniq on orders(provider_order_id) where provider_order_id is not null;
create index if not exists orders_upi_pending_idx on orders(fest_id, method, status);

alter table tickets add column if not exists transferred_to uuid references tickets(id);
alter table tickets add column if not exists void_reason    text;
alter table fests   add column if not exists allow_transfers boolean not null default true;

-- v2.2: email verification. Access granted by email (co-organizer, gate staff, sponsor, ADMIN_EMAILS)
-- only counts once the account has proved it owns that inbox.
-- Accounts that existed before verification was introduced are treated as verified (one-time
-- backfill, runs only when the column is first added) so live volunteers and sponsors keep access.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'users' and column_name = 'email_verified_at') then
    alter table users add column email_verified_at timestamptz;
    update users set email_verified_at = now();
  end if;
end $$;
create table if not exists email_verifications (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table email_verifications enable row level security;

-- Bank credits seen by THE FEST (statement rows, alert emails, pasted SMS).
-- One UTR can only ever confirm one order.
create table if not exists upi_credits (
  id                bigserial primary key,
  fest_id           uuid not null references fests(id) on delete cascade,
  utr               text,
  amount_paise      int  not null,
  source            text not null,                 -- statement | email | paste
  raw               text,
  matched_order_id  uuid references orders(id),
  created_at        timestamptz not null default now()
);
create unique index if not exists upi_credits_utr_uniq on upi_credits(fest_id, utr) where utr is not null;
-- Credits without a UTR are de-duplicated by a hash of amount + the alert/statement line
alter table upi_credits add column if not exists fingerprint text;
create unique index if not exists upi_credits_fp_uniq on upi_credits(fest_id, fingerprint) where utr is null and fingerprint is not null;

-- Co-organizers: other committee members who can manage a fest
create table if not exists fest_members (
  id          uuid primary key default gen_random_uuid(),
  fest_id     uuid not null references fests(id) on delete cascade,
  email       citext not null,
  added_by    uuid references users(id),
  created_at  timestamptz not null default now(),
  unique (fest_id, email)
);

create table if not exists password_resets (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Money THE FEST has paid out to each fest (manual bank transfers for now)
create table if not exists payouts (
  id            uuid primary key default gen_random_uuid(),
  fest_id       uuid not null references fests(id) on delete cascade,
  amount_paise  int  not null check (amount_paise > 0),
  reference     text,                 -- bank transfer UTR
  note          text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

-- Emails sent (or, without an email provider configured, queued here so
-- nothing is lost and links can be read in development).
create table if not exists email_outbox (
  id          bigserial primary key,
  to_email    citext not null,
  subject     text not null,
  body_text   text not null,
  status      text not null default 'queued',   -- queued | sent | failed | logged
  error       text,
  created_at  timestamptz not null default now()
);

alter table upi_credits     enable row level security;
alter table fest_members    enable row level security;
alter table password_resets enable row level security;
alter table payouts         enable row level security;
alter table email_outbox    enable row level security;

-- v2.1: refund tracking (manual_pending = organizer must send UPI back; failed = gateway refund failed, retry)
alter table orders add column if not exists refund_status text check (refund_status in ('done', 'manual_pending', 'failed', 'processing'));
-- Set while an admin retry of a failed gateway refund is in flight (claim, so two retries can't both pay)
alter table orders add column if not exists refund_retry_at timestamptz;
alter table orders add column if not exists refund_failed_paise int not null default 0;  -- gateway refund amount awaiting retry

-- v2.2 (Oct 2026): production readiness
-- Failed-login counter shared by every server instance (Vercel runs many).
-- Keys: 'ip:<email>|<ip>' (tight limit) and 'e:<email>' (looser limit). Rows idle for a day are pruned.
create table if not exists login_attempts (
  key           text primary key,
  fails         int not null default 0,
  window_start  timestamptz not null default now()
);

-- Built-in error log, shown on /admin/errors. The same error again within 5 minutes bumps `repeats` and `at`
-- (last seen) instead of adding a row; rows older than 30 days, or beyond the newest 5,000, are pruned.
create table if not exists app_errors (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  where_   text,
  message  text,
  digest   text,
  path     text,
  repeats  int not null default 1
);
alter table app_errors add column if not exists repeats int not null default 1;
create index if not exists app_errors_at_idx on app_errors(at desc);

-- One row: when the last "new errors" email went to the admins (at most one per 15 minutes)
create table if not exists app_alert_state (
  id             int primary key default 1 check (id = 1),
  last_alert_at  timestamptz not null default now()
);

alter table login_attempts  enable row level security;
alter table app_errors      enable row level security;
alter table app_alert_state enable row level security;

-- v2.3 (Oct 2026): one QR, different counters. Lunch and stay perks live on ticket types (included with an entry
-- ticket, or sold as an add-on attached to an existing ticket); each lunch day / stay check-in / check-out is used once.
alter table ticket_types add column if not exists kind text not null default 'entry' check (kind in ('entry', 'addon'));
alter table ticket_types add column if not exists lunch_days date[] not null default '{}';
alter table ticket_types add column if not exists includes_stay boolean not null default false;
alter table orders add column if not exists addon_for uuid references tickets(id) on delete set null;
create index if not exists orders_addon_for_idx on orders(addon_for) where addon_for is not null;
create table if not exists perk_redemptions (
  id          bigserial primary key,
  fest_id     uuid not null references fests(id) on delete cascade,
  ticket_id   uuid not null references tickets(id) on delete cascade,
  slot        text not null,                      -- 'lunch:2026-11-02' | 'stay_in' | 'stay_out'
  scanned_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  unique (ticket_id, slot)
);
create index if not exists perk_redemptions_fest_idx on perk_redemptions(fest_id, created_at desc);
alter table perk_redemptions enable row level security;

-- v2.4 (Oct 2026): Smart QR. qr_epoch picks the scanner keys sealed into new ticket QRs; "Reset scanner keys"
-- (Volunteers tab, after a lost phone) bumps it.
alter table fests add column if not exists qr_epoch smallint not null default 1;

-- v2.5 (Oct 2026): sponsor leads. A student can choose to share their contact with a brand at its booth (18+ tick,
-- optional phone) and stop sharing any time. After stopping, only the email stays so the brand knows whom to delete.
alter table sponsors add column if not exists lead_offer text;          -- "what students get for sharing", ≤120 chars
create table if not exists sponsor_leads (
  id             bigserial primary key,
  sponsor_id     uuid not null references sponsors(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  name           text,                -- snapshot when shared (null after withdrawal)
  email          citext not null,     -- kept after withdrawal ONLY for the brand's "remove" list
  phone          text,                -- only if the student ticked "Also share my phone"
  college        text,
  course_year    text,                -- optional, typed at the booth (≤60 chars)
  notice_version text not null,       -- the notice the student agreed to, e.g. 'lead-v1'
  shared_at      timestamptz not null default now(),
  withdrawn_at   timestamptz,
  unique (sponsor_id, user_id)
);
create index if not exists sponsor_leads_sponsor_idx on sponsor_leads(sponsor_id, shared_at desc);
create index if not exists sponsor_leads_user_idx on sponsor_leads(user_id);
alter table sponsor_leads enable row level security;

-- v2.6 (Oct 2026): two-way sponsorship requests. Brands keep a profile (optionally listed for organizers); organizers
-- switch on "Show this fest to brands". Either side sends a request; accepting it creates the normal sponsors row.
-- Contacts stay hidden until accepted; money is settled off-platform. "Expired" is not stored: a request whose fest has
-- ended or was cancelled reads as expired and can't be accepted.
alter table fests add column if not exists open_to_sponsors boolean not null default false;
create table if not exists brand_profiles (
  user_id          uuid primary key references users(id) on delete cascade,
  brand            text not null check (char_length(brand) between 2 and 80),
  category         text not null default 'other'
                   check (category in ('food', 'tech', 'edtech', 'fashion', 'finance', 'telecom', 'other')),
  budget_min_paise int  not null default 0 check (budget_min_paise between 0 and 1000000000),
  budget_max_paise int  not null default 0 check (budget_max_paise between 0 and 1000000000),
  cities           text[] not null default '{}' check (cardinality(cities) <= 5),
  about            text check (char_length(about) <= 300),
  listed           boolean not null default false,   -- opt-in to the organizers' "Find brands" list
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists brand_profiles_listed_idx on brand_profiles(listed, category);
create table if not exists sponsor_requests (
  id            uuid primary key default gen_random_uuid(),
  fest_id       uuid not null references fests(id) on delete cascade,
  brand_user_id uuid not null references users(id) on delete cascade,
  direction     text not null check (direction in ('org_to_brand', 'brand_to_org')),
  brand         text not null,                       -- snapshot of the brand name when sent
  tier          text not null,
  amount_paise  int  not null check (amount_paise between 0 and 1000000000),   -- ≤ ₹1 crore
  deliverables  text check (char_length(deliverables) <= 600),
  message       text check (char_length(message) <= 1000),
  status        text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'withdrawn')),
  reply         text check (char_length(reply) <= 300),   -- optional note with a decline
  sent_by       uuid references users(id) on delete set null,
  decided_by    uuid references users(id) on delete set null,
  sponsor_id    uuid references sponsors(id) on delete set null,   -- set on accept
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
-- one open request per fest–brand pair
create unique index if not exists sponsor_requests_open_idx on sponsor_requests(fest_id, brand_user_id) where status = 'sent';
create index if not exists sponsor_requests_brand_idx on sponsor_requests(brand_user_id, created_at desc);
create index if not exists sponsor_requests_fest_idx on sponsor_requests(fest_id, created_at desc);
alter table brand_profiles   enable row level security;
alter table sponsor_requests enable row level security;

-- v2.7 (Oct 2026): Team & Roles. Organizers give students fixed roles by email (Co-organizer, Event head, Judge,
-- Finance lead, Sponsorship lead, Media/PR, Gate/Lunch/Stay volunteer, Desk volunteer). A role works once an account
-- with that email has confirmed it (and, if it has a day, only on that IST day). After v2.7 the app reads and writes only
-- fest_roles; fest_members and fest_staff are kept untouched for rollback (dropped in a later version).
create table if not exists fest_roles (
  id            uuid primary key default gen_random_uuid(),
  fest_id       uuid not null references fests(id) on delete cascade,
  email         citext not null,
  name          text not null default '',
  role          text not null check (role in ('co_organizer', 'event_head', 'judge', 'finance', 'sponsorship', 'media',
                                              'vol_gate', 'vol_lunch', 'vol_stay', 'desk')),
  scope_label   text,               -- "Only for": e.g. "Battle of Bands" (free text in v1)
  scope_day     date,               -- optional: the role works only on this IST day
  event_id      uuid,               -- reserved for Competitions; no foreign key yet
  duty          text,               -- volunteer's desk name, e.g. "Gate 2" (display; the counter comes from the role)
  can_scan      boolean not null default true,
  checked_in_at timestamptz,
  added_by      uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists fest_roles_uniq
  on fest_roles(fest_id, email, role, coalesce(scope_day, '1970-01-01'::date), coalesce(scope_label, ''));
create index if not exists fest_roles_email_idx on fest_roles(email);

-- Who did what in a fest (append-only in the app; rows older than a year are cleared)
create table if not exists fest_activity (
  id          bigserial primary key,
  fest_id     uuid not null references fests(id) on delete cascade,
  actor_id    uuid references users(id) on delete set null,
  actor_email citext not null,
  actor_role  text not null,        -- 'owner' | role key(s) | 'system'
  action      text not null,        -- 'refund', 'fest.edit', 'role.add', 'upi.confirm', …
  summary     text not null,        -- plain sentence shown in the log
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists fest_activity_idx on fest_activity(fest_id, created_at desc);
alter table fest_roles    enable row level security;
alter table fest_activity enable row level security;

-- One-time copy: existing co-organizers and volunteers become roles. Runs only once per database (marked with a
-- table comment), so re-running this file never brings back a role an organizer removed later.
do $$
begin
  if obj_description('public.fest_roles'::regclass, 'pg_class') is distinct from 'v2.7 copied' then
    insert into fest_roles (fest_id, email, role, added_by, created_at)
      select fest_id, email, 'co_organizer', added_by, created_at from fest_members
      on conflict do nothing;
    insert into fest_roles (fest_id, email, name, role, duty, can_scan, checked_in_at, created_at)
      select fest_id, email, name,
             case when lower(trim(duty)) like 'lunch%' then 'vol_lunch'
                  when lower(trim(duty)) like 'stay%' or lower(trim(duty)) like 'hostel%' then 'vol_stay'
                  else 'vol_gate' end,
             duty, can_scan, checked_in_at, created_at from fest_staff
      on conflict do nothing;
    comment on table fest_roles is 'v2.7 copied';
  end if;
end $$;

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
alter table orders add column if not exists refund_failed_paise int not null default 0;  -- gateway refund amount awaiting retry

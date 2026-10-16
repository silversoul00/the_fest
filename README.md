# THE FEST

**The operating system for Indian college festivals.** Students buy tickets, organizers run the fest, gate volunteers scan signed QR passes, sponsors see real numbers — one web app that works on any phone.

Built with **Next.js 15** · **PostgreSQL (Supabase)** · **Razorpay** · ECDSA-signed tickets.

---

## Portals

| Portal | Path | What it does |
|---|---|---|
| 🎓 Student | `/fests`, `/tickets`, `/me` | Discover fests, buy tickets (Razorpay or free), carry a signed QR ticket, booth check-ins |
| ⚡ Organizer | `/organizer` | Create & publish fests, ticket types, live dashboard, sales + CSV export, schedule (with clash detection), volunteers, announcements, sponsors |
| 📷 Gate Scanner | `/scan` | Camera QR scanning or typed codes, instant admit / duplicate / fake verdicts, per-gate counts |
| 🏷️ Sponsor | `/sponsor` | Verified footfall, booth visits by hour, cost per visit, audience by college, printable booth QR |

**Sessions.** You pick a role once at signup; returning users land straight in their portal. The **Gate Scanner always asks for a fresh login** — its session dies when the browser closes or the volunteer taps Lock.

**Tickets can't be faked or reused.** Each QR is signed with an ECDSA P-256 private key held only by the server. Check-in is a single atomic database update, so a ticket scanned at two gates at the same instant gets in once. (Tested: 8 simultaneous scans → 1 admit.)

**No overselling.** Seats are reserved in a locked transaction and held 15 minutes during payment; abandoned checkouts release automatically. (Tested: 6 buyers for the last seat → 1 sale.)

---

## Deploy (≈15 minutes)

### 1 · Supabase — the database
1. In your Supabase project open **SQL Editor → New query**, paste all of [`db/schema.sql`](db/schema.sql), click **Run**.
2. Go to **Project Settings → Database → Connection string**, choose **Transaction pooler** (port `6543`), copy it and put your database password in place of `[YOUR-PASSWORD]`. That's your `DATABASE_URL`.

> The app connects to Postgres from the server only. RLS is enabled with no policies, so Supabase's public API (anon key) can't touch these tables.

### 2 · Ticket signing keys
On your computer, in this folder:
```bash
npm install
npm run keys
```
It prints `TICKET_PRIVATE_KEY` and `TICKET_PUBLIC_KEY`. **Keep the private key secret** — anyone who has it can forge tickets.

### 3 · Razorpay (test mode)
Razorpay Dashboard → switch to **Test Mode** → **Settings → API Keys → Generate**. Copy the Key ID (`rzp_test_…`) and Secret.
Then **Settings → Webhooks → Add**: URL `https://YOUR-DOMAIN/api/webhooks/razorpay`, events `payment.captured` and `order.paid`, and set a secret.

Skip this step and checkout runs in clearly-labelled **demo mode** (no money moves, tickets still real). Demo checkout switches off automatically once Razorpay keys are set.

### 4 · Vercel
1. Project → **Settings → General → Framework Preset: Next.js** (it was "Other" for the old static page). Build command and output: leave default.
2. **Settings → Environment Variables** — add everything from [`.env.example`](.env.example):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction-pooler string |
| `TICKET_PRIVATE_KEY` / `TICKET_PUBLIC_KEY` | from `npm run keys` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | from Razorpay (optional) |
| `NEXT_PUBLIC_SITE_URL` | `https://thefest.in` (or your vercel.app URL) |
| `PLATFORM_FEE_PAISE` | `1500` (₹15) |
| `PLATFORM_FEE_PAYER` | `student` (fee added at checkout) or `organizer` (deducted from payout) |

3. Redeploy. Open `/api/health` — you should see `"db":"up"`.

### 5 · Demo data (optional)
To show the product with sample fests, run once **against your Supabase DB** from your computer (put `DATABASE_URL` in `.env.local` first):
```bash
npm run db:seed
```
It only runs on an empty database. Demo logins, password `password123`:
`student@thefest.in` · `organizer@thefest.in` · `sponsor@thefest.in` · `volunteer@thefest.in`

All sample fests, colleges and brands are fictional. Delete them before real launch (or start with an empty DB).

---

## Local development
```bash
npm install
cp .env.example .env.local      # fill DATABASE_URL (local Postgres or Supabase) and keys
npm run keys                    # paste output into .env.local
npm run db:setup                # create tables
npm run db:seed                 # sample data (add -- --reset to wipe & reseed, local only)
npm run dev                     # http://localhost:3000
```
Test a scanner without a phone: `npm run sign-ticket -- <ticketId> <festId>` prints a valid QR payload.

## Project layout
```
db/schema.sql                 Database schema (idempotent — safe to re-run)
scripts/                      db-setup, seed, keys, sign-ticket
src/lib/                      db, auth (sessions), ticket-crypto, orders, payments, scan, queries
src/app/(auth)/               login, signup
src/app/(student)/            discover, fest page + checkout, tickets, profile
src/app/organizer/            dashboard + 8 management tabs
src/app/scan/                 gate scanner (login, camera, verdicts)
src/app/sponsor/              sponsor dashboards
src/app/booth/                booth QR check-in + printable poster
src/app/api/                  checkout, Razorpay verify + webhook, scan, health
prototype/                    the original single-file demo, kept for reference
```

## Roadmap
- WhatsApp / email ticket delivery and reminders
- Razorpay Route for automatic organizer payouts
- Offline gate mode (verify signatures on-device, sync later)
- Google sign-in, password reset
- React Native app

## Business model
₹15 per paid ticket (convenience fee) · sponsor analytics · Year 1 target: 150 fests.

---
Built by Harshith D S · Bengaluru

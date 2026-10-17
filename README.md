# THE FEST

**The operating system for Indian college festivals.** Students buy tickets, organizers run the fest, gate volunteers scan signed QR passes, sponsors see real numbers — one web app that works on any phone.

Built with **Next.js 15** · **PostgreSQL (Supabase)** · **Razorpay** · ECDSA-signed tickets.

---

## Portals

| Portal | Path | What it does |
|---|---|---|
| 🎓 Student | `/fests`, `/tickets`, `/me` | Discover fests, buy tickets (Cashfree/Razorpay, zero-fee bank UPI, or free), carry a signed QR ticket, booth check-ins |
| ⚡ Organizer | `/organizer` | Create & publish fests, ticket types, live dashboard, sales + CSV export, schedule (with clash detection), volunteers, announcements, sponsors |
| 📷 Gate Scanner | `/scan` | Camera QR scanning or typed codes, instant admit / duplicate / fake verdicts, per-gate counts |
| 🏷️ Sponsor | `/sponsor` | Verified footfall, booth visits by hour, cost per visit, audience by college, printable booth QR |

**Sessions.** You pick a role once at signup; returning users land straight in their portal. The **Gate Scanner always asks for a fresh login** — its session dies when the browser closes or the volunteer taps Lock.

**Tickets can't be faked or reused.** Each QR is signed with an ECDSA P-256 private key held only by the server. Check-in is a single atomic database update, so a ticket scanned at two gates at the same instant gets in once. (Tested: 8 simultaneous scans → 1 admit.)

**No overselling.** Seats are reserved in a locked transaction and held 15 minutes during payment; abandoned checkouts release automatically. (Tested: 6 buyers for the last seat → 1 sale.)

---

## Deploy

Follow **[docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md)** — a step-by-step guide (works on a phone) for Vercel + Supabase:
database connection (Supabase **transaction pooler**, port 6543), ticket keys (made in the browser at `/setup/keys`),
email, every environment variable, Preview first, becoming admin, going live, rollback, uptime alerts and encrypted backups.

- `vercel.json` builds this branch as Next.js in Mumbai (`bom1`); the project's Framework setting doesn't need changing.
- `/api/health` returns 503 and lists the **names** of missing/wrong settings; 200 `{"status":"ok"}` when all is well.
- Card checkout runs only with real gateway keys in production. Without them it is switched off (bank UPI and free
  tickets still work). The pretend "demo" checkout exists only locally with `DEMO_PAYMENTS=1`.
- `npm run db:seed` refuses any non-local database (demo data includes an admin with a public password).

---

## Local development
```bash
npm install
cp .env.example .env.local      # fill DATABASE_URL (local Postgres or Supabase) and keys
npm run keys                    # paste output into .env.local
npm run db:setup                # create tables
npm run db:seed                 # sample data (local databases only; -- --reset wipes & reseeds)
# add DEMO_PAYMENTS=1 to .env.local for the pretend card checkout while developing
npm run dev                     # http://localhost:3000
```
Test a scanner without a phone: `npm run sign-ticket -- <ticketId> <festId>` prints a valid QR payload.

## Project layout
```
db/schema.sql                 Database schema (idempotent — safe to re-run)
scripts/                      db-setup, seed, keys, sign-ticket, backup.sh / restore.sh (encrypted)
src/lib/                      db, auth (sessions), ticket-crypto, orders, payments, scan, queries
src/app/(auth)/               login, signup
src/app/(student)/            discover, fest page + checkout, tickets, profile
src/app/organizer/            dashboard + 8 management tabs
src/app/scan/                 gate scanner (login, camera, verdicts)
src/app/sponsor/              sponsor dashboards
src/app/booth/                booth QR check-in + printable poster
src/app/api/                  checkout, Cashfree/Razorpay verify + webhooks, scan, health
src/lib/env.ts                where we run (production/preview/dev), site URL, settings check
src/lib/errors.ts             error log (/admin/errors) + alert emails, after-response work
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

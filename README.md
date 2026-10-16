# THE FEST

**The operating system for Indian college festivals** — the Shopify/Stripe for college fests.

Students discover fests and buy tickets. Organizers run the whole fest from one dashboard. Gate volunteers scan cryptographically-signed QR tickets. Sponsors see live ROI instead of a PDF report three weeks later.

🌐 **Live:** [thefest.in](https://thefest.in)

---

## Portals

| Portal | Who | What they do |
|---|---|---|
| 🎓 **Student** | Attendees | Discover fests, buy tickets, carry a QR ticket, multi-fest view |
| ⚡ **Organizer** | Fest core team | Revenue dashboard, schedule builder, volunteer check-in, announcements, leaderboard, onboarding wizard |
| 📷 **Gate Scanner** | Entry volunteers | Validate signed QR tickets, block duplicates, live scan feed |
| 🏷️ **Sponsor** | Brands | Live footfall & engagement analytics, activations, audience insights |

### Sessions
- The role is picked **once** and remembered on the device.
- Student, Organizer and Sponsor sessions persist across visits. Every portal has **⇄ Switch Portal** to go back to the role picker.
- **Gate Scanner never stays signed in** — it must re-authenticate every time, so a lost phone at the gate can't keep letting people in.

## Running it

The app is a single static file — no build step.

```bash
npx serve .        # or: python3 -m http.server 8080
```

Without a backend it runs in **demo mode** (any email/password works). If a backend answers `GET /api/health` with `{"status":"ok"}` on the same origin, it switches to **live mode** automatically.

Seed accounts for live mode: `student@thefest.in`, `organizer@thefest.in`, `scanner@thefest.in` — password `password123`.

## Files

```
index.html          The whole app (HTML + CSS + JS)
manifest.json       PWA manifest — installable on Android/iOS
sw.js               Service worker — offline app shell, API never cached
icons/              App icons (192, 512, maskable, apple-touch, favicon)
og-image.png        1200×630 social preview
robots.txt          Crawl rules
sitemap.xml         Sitemap for thefest.in
netlify.toml        Netlify headers
vercel.json         Vercel headers
```

## Deploying

**Vercel** or **Netlify** (both free): import this repo, no build command, publish directory `/`. Then add the custom domain `thefest.in`.

## Roadmap — production stack

- **Frontend:** React Native (iOS + Android) + this web app as PWA
- **Backend:** Node.js, PostgreSQL, Redis
- **Tickets:** ECDSA-signed QR payloads, verified offline at the gate

## Business model

- ₹15 commission per ticket
- ₹1 per attendee for sponsor exposure
- Year 1 target: 150 fests

## Design system

Bebas Neue (display) · Space Mono (labels/data) · DM Sans (body). Dark theme, primary accent `#FFE034`.

---

Built by Harshith D S · harshithds4@gmail.com

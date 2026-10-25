# Invention note (draft) — Role-sealed, offline-verifiable event ticket QR

**Inventor:** Harshith D S, Bengaluru · **Date of record:** 18 Oct 2026 · **CONFIDENTIAL — do not publish, post, pitch or
push to a public repository before a provisional application is filed.**
*This is a plain-language technical note for a patent attorney. It is not legal advice; the attorney decides patentability,
claim scope and filing strategy.*

## 1. Problem
College fests in India run gates, food counters, hostel desks and first-aid posts with student volunteers, on weak or no
mobile network. Today a ticket QR is either (a) a bare ID that is useless without a server, or (b) a code that shows the same
data to everyone who scans it. Problems: data leaks to anyone with a phone camera; volunteers see more personal data than
their job needs; scanning stops when the network drops; screenshots are resold or shared; and medical details that could
save a life in an emergency are not available at the first-aid post.

## 2. Known prior art (to be searched properly by the attorney)
- **Denso Wave SQRC** — one QR with public data and a private part readable only by a reader holding the key.
- **US patents on "multi-level security in high-capacity QR / optical codes"** (e.g. US 12307325, US 12682196): data split
  by security level, encoded with public vs private codebooks, codebooks fetched from URLs; one titled "dynamic".
- **Ticketmaster SafeTix** — barcode rotates every 15 s using TOTP with per-event and per-customer secrets, checked by the server.
- **Secret in URL fragment** (e.g. encrypted pastebins): data after `#` is not sent to the web server.
- Digitally signed tickets / boarding passes (signature verified offline with a public key).

Each element exists alone. **The claimed novelty is the specific combination and how the parts depend on each other.**

## 3. What is new (the combination)
1. A single ticket QR whose content is an **ordinary web address**: any camera opens a public page with only basic,
   non-private facts, while the **sealed role sections ride in the URL fragment**, so the web server and network never
   receive them.
2. **Several independently sealed sections, one per operational role** (gate, food, stay, first aid, organizer), each
   encrypted with a different key derived per event, per role and per key-generation number; a scanner device is given
   only the keys of the role its user is assigned, so the same image reveals different information to different scanners.
3. **One signature over the public part and all sealed parts**, verified offline before decryption, so a volunteer who holds
   a role key still cannot forge or alter any section.
4. **Rotating anti-screenshot code whose verification secret is itself carried inside the gate's sealed section**: the
   holder's phone derives a short time-step code; an offline gate scanner opens its section, recovers the secret and checks
   the code against its own clock — no server and no per-ticket download needed.
5. **Key-generation number inside the code + role-key reset**: a lost volunteer phone is handled by moving the event to a new
   key generation; new renders use it, scanners accept the current and previous generation, older codes fall back to online.
6. **Opt-in emergency medical section** visible only to first-aid role scanners, offline.
7. **Hybrid result**: the scanner shows the offline (sealed) result instantly, then, when online, the server's live status
   replaces it; offline uses are queued and reconciled later.

## 4. How it works (one embodiment)
- Code = `https://<domain>/t/<P>#<F>.<L>`. P = version, ticket id, key generation, short keyed tag (public page uses it to
  refuse guessed or harvested ids). F = random nonce, sections [role id, length, AES-256-GCM ciphertext with short tag], and
  an ECDSA P-256 signature over "TF2"‖P‖nonce‖sections. L = 4-byte HMAC of the current 30-second step under a per-ticket
  secret that is stored only inside the gate section and on the holder's logged-in device.
- Role keys = HKDF(master, event id, role, generation). Delivered over an authenticated session to a scanner, stored as
  non-extractable keys with an expiry tied to the session and the event end.
- Sections hold short codes (bitmask of meal days, stay flag, blood-group code, packed phone digits), keeping the whole
  code ≤ 300 characters (QR version ≤ 13 at medium error correction), so it scans fast on low-end phones.

## 5. Technical effects (relevant to India s.3(k) / CRI Guidelines 2025)
- **Security of a computer system:** data minimisation at the device level — the network and server never carry the sealed
  data; each scanner can decrypt only its role's data; forgery is blocked even for insiders holding a role key.
- **Works without network:** verification, role disclosure and anti-screenshot checking happen on the device offline.
- **Less data transfer and server load:** no per-scan download of ticket data, no per-ticket secret lists on scanners.
- **Bounded code size / scan reliability:** fixed byte layout with short tags (integrity from the outer signature) keeps the
  symbol small enough for reliable scanning.
- **Controlled compromise:** key generations limit the damage of a lost device without reissuing printed tickets.
These should be argued as technical improvements to how devices verify and disclose data, not as a business method.

## 6. Possible claims outline (for the attorney to shape)
1. **Method** of generating a machine-readable ticket code comprising: a locator readable by any generic reader that leads
   to a public record; a fragment not transmitted to the server, containing a plurality of sections each encrypted under a
   key specific to (event, role, generation); and a signature over locator and all sections.
2. **Method at a scanner**: verify signature offline; decrypt only sections for which the device holds role keys; display
   role-specific data; when connectivity exists, request and display server status overriding the offline result.
3. Dependent: time-step code with the verification secret carried inside a role-sealed section.
4. Dependent: key generation number carried in the code; acceptance of current and previous generations; reset on device loss.
5. Dependent: opt-in medical section limited to a first-aid role.
6. Dependent: offline use queue reconciled with the server; local duplicate check.
7. **System** claim (server + holder device + scanner devices) and **medium** claim mirroring 1–2.

## 7. Filing advice (practical, not legal advice)
- **File first, disclose later.** India has no general grace period; posts, demos, pitch decks without NDA, a public GitHub
  repo or putting the feature live on thefest.in can count as disclosure. The project repo is currently **public** — keep
  this work local or make the repo private until filing.
- A **provisional application** (Form 1 + Form 2) secures the date; e-filing fee about ₹1,600 for an individual or DPIIT
  startup (Form 28). The **complete specification must follow within 12 months — no extension.**
- Ask the attorney: a prior-art search (SQRC, the US multi-level QR patents, SafeTix, signed-ticket patents); whether to claim
  in India only or file a PCT within 12 months; how to frame technical effect under the CRI Guidelines 2025; whether the
  inventor's earlier conversations/notes create any disclosure issue.
- Keep dated records (this note, commits kept private) as evidence of invention date.

# Launch checklist — after merging `full-app`

Do these in order. Nothing here has been changed in your Vercel, Supabase, Cashfree or Razorpay accounts.

## 1. Database (Supabase)
- [ ] Run `npm run db:setup` against the production `DATABASE_URL`. It's safe to re-run: it only adds what's missing.
      Existing accounts are marked email-confirmed once, so current volunteers and sponsors keep access.
- [ ] Do **not** run `db:seed` against production.

## 2. Vercel environment variables
| Variable | Value |
|---|---|
| `ADMIN_EMAILS` | your email — gives you `/admin` (the account must be email-confirmed) |
| `RESEND_API_KEY`, `EMAIL_FROM` | needed so sign-up confirmations, password resets and order emails actually send |
| `PLATFORM_FEE_MODE` + `PLATFORM_FEE_PAISE` or `PLATFORM_FEE_PERCENT/MIN/MAX` | your commission (default ₹15 flat) |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=sandbox` | start with **test** keys |
| `REQUIRE_FEST_APPROVAL` | leave on, so new fests wait for your approval |
| `NEXT_PUBLIC_LEGAL_*`, `NEXT_PUBLIC_SUPPORT_*`, `NEXT_PUBLIC_GRIEVANCE_OFFICER` | business details on the policy pages |
| `UPI_ALERT_SENDERS` | optional — bank domains allowed to confirm UPI orders by email |

## 3. Test on the preview deployment
- [ ] Sign up a new account → confirmation email arrives → link works.
- [ ] Forgot password → email arrives → reset works.
- [ ] Cashfree sandbox purchase → ticket appears → refund one ticket from Sales → refund shows in the Cashfree dashboard.
- [ ] Bank UPI: turn it on for a test fest, pay ₹1-something to the fest UPI ID, enter the UTR, paste the bank SMS in Payments → ticket issued.
- [ ] Scan a ticket at the gate on a phone.

## 4. Before taking real money
- [ ] Lawyer/CA reads the policy pages; then set `NEXT_PUBLIC_LEGAL_FINAL=1`.
- [ ] Cashfree KYC done; switch to live keys and `CASHFREE_ENV=production`.
- [ ] Set the Cashfree webhook URL to `https://<your-domain>/api/webhooks/cashfree`.

## Local release check
`bash tests/run-e2e.sh` (local Postgres only) runs every browser flow, the UPI, refund, password and team checks, and the concurrency tests.

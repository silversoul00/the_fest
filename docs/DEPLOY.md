# Deploying THE FEST

The full step-by-step guide (phone-friendly) is **[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md)**:
where the site lives today (Vercel or Netlify), the database, ticket keys, email, every environment variable,
the Preview deploy, becoming admin, testing, going live, rollback, uptime alerts and backups.

Short version:
1. Apply the Oct 17 schema update in Supabase (`thefest`, Mumbai) — SQL in Part 2a.
2. Set the environment variables in Vercel (Part 5). Redeploy after every change.
3. Test the `full-app` Preview (Part 8) until `/api/health` says `ok`.
4. Production → Branch Tracking → `full-app` (Part 9). Roll back with Instant Rollback.

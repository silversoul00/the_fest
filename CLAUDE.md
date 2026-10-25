# THE FEST — notes for Claude

- Every task goes through the team in `docs/team/WORKFLOW.md`: Researcher → Builder → Supervisor → Tester → fixes.
  The four roles are the subagents in `.claude/agents/`.
- `docs/team/BRIEF.md` holds Harshith's instructions and decisions. Read it first; add new ones to it.
- Never merge to `main`. Push to `full-app` only for meaningful, tested batches — not for every small change.
- Never change Harshith's Supabase, Vercel, Cashfree or Razorpay accounts without his say-so in this conversation.
- Production database: Supabase project `thefest` (id `uxhpvbgxftsdpcyycxpq`, Mumbai). Tables match `db/schema.sql` including v2.2 ops tables, v2.3 counters (applied Oct 17), v2.4 Smart QR qr_epoch (applied Oct 18, both databases) and v2.5 sponsor_leads, v2.6 sponsorship requests (applied Oct 18) , v2.7 team roles (applied Oct 24) and v2.8 fest events (applied Oct 25; both databases). Preview/demo database: `thefest-preview` (id `utcobvnsayyoeyqcmvgl`), loaded with db/demo-seed.sql.
- Release check: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` (local Postgres only).

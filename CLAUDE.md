# THE FEST — notes for Claude

- Every task goes through the team in `docs/team/WORKFLOW.md`: Researcher → Builder → Supervisor → Tester → fixes.
  The four roles are the subagents in `.claude/agents/`.
- `docs/team/BRIEF.md` holds Harshith's instructions and decisions. Read it first; add new ones to it.
- Never merge to `main`. Push to `full-app` only for meaningful, tested batches — not for every small change.
- Never change Harshith's Supabase, Vercel, Cashfree or Razorpay accounts without his say-so in this conversation.
- Production database: Supabase project `thefest` (id `uxhpvbgxftsdpcyycxpq`, Mumbai), created Oct 17, 2026. Tables match `db/schema.sql` up to v2.1; the three v2.2 tables (`login_attempts`, `app_errors` with `repeats`, `app_alert_state`) still need adding in production (SQL in `docs/LAUNCH-CHECKLIST.md` Part 2a) — the coordinator applies them after review. Until then `/api/health` there reports `database setup incomplete`.
- Release check: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` (local Postgres only).

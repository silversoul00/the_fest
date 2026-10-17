# THE FEST — notes for Claude

- Every task goes through the team in `docs/team/WORKFLOW.md`: Researcher → Builder → Supervisor → Tester → fixes.
  The four roles are the subagents in `.claude/agents/`.
- `docs/team/BRIEF.md` holds Harshith's instructions and decisions. Read it first; add new ones to it.
- Never merge to `main`. Push to `full-app` only for meaningful, tested batches — not for every small change.
- Never change Harshith's Supabase, Vercel, Cashfree or Razorpay accounts without his say-so in this conversation.
- Production database: Supabase project `thefest` (id `uxhpvbgxftsdpcyycxpq`, Mumbai), created Oct 17, 2026. Tables match `db/schema.sql`.
- Release check: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers bash tests/run-e2e.sh` (local Postgres only).

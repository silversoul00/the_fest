# How THE FEST gets built — the team

Harshith asked (Oct 17, 2026) for every piece of work to go through four roles, in this order:

```
 Harshith's request
        │
        ▼
 1. RESEARCHER  ── research brief ──►  2. BUILDER  ── code + tests ──►  3. SUPERVISOR
 (fest-researcher)  docs/team/research/   (fest-builder)   local commit    (fest-supervisor)
                                                                              │ verdict + test plan
                                                                              ▼
                                       fixes ◄── failures / findings ── 4. TESTER (fest-tester)
                                         │                                   docs/team/reviews/
                                         └──────── back to BUILDER, then SUPERVISOR + TESTER again
                                                        (max 3 rounds, then ask Harshith)
        ▼ only when Supervisor = PASS and Tester = ALL PASS
 Claude batches the work → one push to the full-app branch → plain-language summary to Harshith
```

| Role | Definition | Writes | Never does |
|---|---|---|---|
| Researcher | `.claude/agents/fest-researcher.md` | `docs/team/research/*.md` | app code |
| Builder | `.claude/agents/fest-builder.md` | `src/`, `db/`, `tests/`, local commits | push, touch `main` or Harshith's accounts |
| Supervisor | `.claude/agents/fest-supervisor.md` | `docs/team/reviews/*-review-*.md` | edit app code |
| Tester | `.claude/agents/fest-tester.md` | `tests/`, `docs/team/reviews/*-test-*.md` | edit app code, weaken tests |

**Harshith's brief** (`docs/team/BRIEF.md`) is what the Supervisor checks everything against. Every new instruction or
decision from Harshith is added there in the same change.

Small fixes (a typo, one line) can skip the Researcher, but never the Supervisor and Tester.

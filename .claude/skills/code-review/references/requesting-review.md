# Requesting code review (prumo)

A reviewer's time is the scarcest resource on the team. Every PR you open is a withdrawal from that budget. Make it small, make it self-contained, make it easy to verify.

## Before you push

- Run the **verification gate** (`references/verification-before-completion.md`).
- Walk the **prumo checklist** in `SKILL.md` against your diff yourself. Find the bugs before the reviewer does.
- `git diff dev...HEAD` and read every line. If you can't justify it out loud, it shouldn't be there.
- Strip noise: unrelated whitespace, `print()` debugging, commented-out code, "TODO: rename" notes you never followed up on.

## Branch + commit

- Branch off `dev`. Name it descriptively: `fix/hitl-session-toctou` not `wip-fix`.
- Commits follow **Conventional Commits** (`https://www.conventionalcommits.org/v1.0.0/`):
  - `feat(scope): ...` — new feature
  - `fix(scope): ...` — bug fix
  - `refactor(scope): ...` — no behavior change
  - `perf(scope): ...` — performance improvement
  - `docs(scope): ...` — docs only
  - `test(scope): ...` — tests only
  - `chore(scope): ...` — tooling, deps, no source change
  - `ci(scope): ...` — CI config
- Scopes used in repo history: `backend`, `frontend`, `hitl`, `extraction`, `qa`, `templates`, `ci`, `deploy`, `e2e`, `alembic`.
- Imperative mood ("add", "fix", "remove"), no period at end, under 70 chars.
- Body (if needed) wraps at 72 chars, explains *why*, not *what*.

Examples from the repo log:

```
fix(qa): drop double-unwrap of ApiResponse envelope in useRunAIExtraction
feat(extraction): unify Data Extraction with QA proposal-write pattern
fix(deploy): raise Gunicorn and client timeouts for template clone
refactor: cleanup duplication + dead code after auto-bug-fix wave
```

## The PR body template

```markdown
## Why

<1–3 sentences. What problem, why now. Link issue if any.>

## What changed

- <bullet per logical change, grouped by area>
- <link to file:line where the change is non-obvious>

## Risk

<What could break? Which areas are exercised? Migrations / RLS / state-machine changes get a paragraph.>

## Test plan

- [ ] `make lint-backend` clean
- [ ] `make test-backend` passes (note any newly added tests)
- [ ] `npm run lint` clean
- [ ] `npm run test:run` passes
- [ ] Manual: <steps a reviewer can reproduce>

## Out of scope

<What you noticed but deliberately did not fix here, with link to follow-up issue if filed.>
```

## Targeting + labels

- **Base branch:** `dev`. Always. Never `main` unless explicitly approved.
- **Labels:**
  - `needs-review` — standard.
  - `security` — touches auth, RLS, endpoint exposure, secrets.
  - `migration` — touches `backend/alembic/versions/` or `supabase/migrations/`.
  - `breaking` — changes API shape, public route, or DB-visible enum.

## Sizing

Hard limits:

- **< 400 lines of diff** for a normal PR.
- **< 800 lines** for a refactor or rename that has to be atomic.
- **> 1000 lines** = split, period. If you can't split, write a "review entry point" comment with reading order: which 3 files to read first, which 10 are mechanical.

Migrations and seed scripts count as diff. Generated files (lockfiles, build artifacts) do not — but if your PR is 80% lockfile churn, separate the dependency bump.

## Self-review pass

After pushing, open the PR yourself and click through every file:

- Note anything unclear directly on the diff so the reviewer doesn't have to guess.
- Flag your own concerns: "I'm not sure about the lock here — would `select(...).with_for_update()` be cheaper?"
- Resolve dead code. If a function isn't called yet, mark "wired in next PR" explicitly.

## Choosing reviewers

- Domain owner of the file(s) you touched (check `git log -- <path>` for recent authors).
- One additional reviewer for cross-cutting changes (security, RLS, migrations).
- Avoid pinging more than two humans — splits attention, slows review.

## After CI runs

- **Red CI:** fix before pinging. Pinging on red CI burns trust.
- **Yellow / pending:** wait or note "blocked on flaky test, manually verified".
- **Green:** ping reviewers. Single message, link the PR, one-sentence summary.

## When review takes too long

- After 2 working days with no review: gentle nudge in the same channel.
- After 4 days: re-open the conversation: is the PR too big? Wrong audience? Can it be split?
- Never merge without a review unless you have explicit fallback authorization documented in the PR.

## Hotfix flow

- Hotfix branches off `dev` like everything else.
- PR labelled `hotfix` gets one-reviewer fast-track, **not** zero-reviewer.
- Hotfixes still run the full verification gate. Speed is not an excuse to skip tests.

## Bottom line

Small PRs. Conventional commit. Clear PR body with Why / What / Risk / Test plan. Self-review before pinging. Label so the right person sees it. Never merge to `main` directly.

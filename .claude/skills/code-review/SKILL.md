---
name: code-review
description: Use BEFORE claiming done, before writing a PR body, when receiving review feedback (especially unclear or technically questionable), when requesting review, or after completing a feature/bugfix. Enforces technical rigor over performative agreement, evidence-based completion claims, and a prumo-specific review checklist tuned to recurring incident classes (BOLA, run-state TOCTOU, error swallowing, schema drift, ApiResponse envelope drift, stale TanStack cache). Triggers on phrases "looks good", "should be fine", "I'll fix it", "ready to merge", "tests pass", "done", "complete", "fixed", "ready for review", "let me draft the PR". Be pushy about running it.
---

# Code Review (prumo)

Three practices, one principle: **evidence before claims**.

1. **Verification gate** — run the actual commands before saying "done".
2. **Requesting review** — small PR, clear risk + test plan, label `needs-review`.
3. **Receiving feedback** — technical rigor over performative agreement.

Plus: a **prumo-specific review checklist** grounded in the bug classes that have actually shipped here. Every checklist item exists because we paid for it once.

---

## Core principle

> Technical correctness over social comfort. Verify before implementing. Ask before assuming. **Evidence before claims.**

Every claim in a review (yours or theirs) must link to one of:

- A `file:line` reference (e.g. `backend/app/api/v1/endpoints/extraction_runs.py:88`).
- A command output (test run, lint run, grep, `git diff`).
- A doc reference (`docs/reference/extraction-hitl-architecture.md §4.1`).

"It should work" / "it looks right" / "probably fine" are not evidence. If you find yourself typing one of these phrases, stop and run something.

---

## When this skill fires

Before any of these statements leave your mouth, run this skill:

- "Done", "complete", "fixed", "ready", "should be good", "tests pass", "build succeeds".
- "Looks good to me", "LGTM", "approving".
- "Ready to merge", "ready for review", "let me draft the PR".
- "I'll just push this and see".
- Receiving a review comment, especially when your instinct is to immediately agree or immediately disagree.

If the user explicitly asks for a code review, security review, or PR draft — this skill is mandatory.

---

## The verification gate (the Iron Law)

**No completion claim ships without fresh evidence.**

`IDENTIFY command → RUN command in full → READ output → CONFIRM it matches the claim → THEN claim`

Skipping any step is lying, not reviewing.

### Commands that count as evidence on prumo

| Claim                                         | Evidence (run from repo root unless noted)         |
| --------------------------------------------- | -------------------------------------------------- |
| Backend tests pass                            | `make test-backend` — exit 0, no `FAILED` / `ERROR`|
| Backend lint clean                            | `make lint-backend` — exit 0, no diff after format |
| Frontend tests pass                           | `npm run test:run` — exit 0                        |
| Frontend lint + typecheck                     | `npm run lint` + `npm run typecheck`               |
| Migration applies cleanly                     | `cd backend && alembic upgrade head` — exit 0      |
| Migration is reversible                       | `alembic downgrade -1 && alembic upgrade head`     |
| Bug fixed                                     | New test reproducing the bug now passes            |
| Endpoint authorized                           | grep for `ensure_project_member` in the endpoint   |
| No N+1                                        | Run the request with SQL echo, count queries       |

### Red flags — stop and run something

- Using "should" / "probably" / "seems to" about your own code.
- "I refactored this, should be equivalent" without a test re-run.
- Self-congratulation before verification ("nice, that should do it").
- Committing because the change "looks small".
- Trusting an agent's report instead of reading its tool outputs.

Full protocol: `../debugging/verification-before-completion/SKILL.md` (the canonical gate; `references/verification-before-completion.md` now redirects there).

---

## The prumo review checklist

Apply to every diff before requesting review and before approving someone else's PR. Each item exists because we shipped this bug class before — see the linked git history.

### A. Authorization (OWASP API #1 — BOLA)

- [ ] Every endpoint touching project data calls `ensure_project_member` (or a stricter role check) **before** the data access. Pattern: see `backend/app/api/v1/endpoints/extraction_runs.py:88`.
- [ ] When the endpoint takes `run_id` / `article_id` / `template_id` but **not** `project_id`, resolve the project and run the membership check. Don't trust the URL.
- [ ] Manager-only operations call the manager check, not just membership. Re-grep both layers.
- [ ] Frontend never controls authorization — server is authoritative. If the client decides who can do what, write it down as a defect.

Why: BOLA is the #1 OWASP API risk and the #1 historical bug class on prumo. Audit playbook: `references/bola-audit.md`.

### B. RLS + multi-tenancy

- [ ] New tables have RLS enabled and a policy. Check `backend/alembic/versions/0018_*` for the helper pattern (`is_project_reviewer`).
- [ ] Policies are written in terms of `auth.uid()` and `project_memberships`, not raw user IDs.
- [ ] If the migration relaxes RLS, the PR body explains who gains access and why.

Why: Supabase RLS is our second line of defense. Migration 0018 relaxed reviewer writes for a reason — every RLS relaxation needs the same scrutiny. Full checklist: `references/rls-review.md`.

### C. Run-state and concurrency (TOCTOU)

- [ ] Run-state transitions go through `run_lifecycle_service`, not ad-hoc `run.status = ...` assignments.
- [ ] State checks (`if run.status == X`) and the subsequent write happen in the same DB transaction, or use a conditional `UPDATE ... WHERE status = X RETURNING ...` so two requests can't both win.
- [ ] HITL session opens / closes are idempotent — re-running the same request doesn't double-create rows.
- [ ] Celery tasks that mutate run state re-fetch under lock; don't trust the state captured at enqueue time.

Why: Run-state TOCTOU has bitten us multiple times — see commit `1994ceb fix(backend): resolve 31 auto-found bugs across HITL/extraction stack`. Race-spotting guide: `references/race-conditions.md`.

### D. Error swallowing

- [ ] No `.catch(() => ({ success: true }))` or any catch that returns a success-shaped object without context.
- [ ] `Promise.all` is only used when **every** child must succeed. Otherwise use `Promise.allSettled` and surface partial failures explicitly.
- [ ] No `except Exception: pass` or bare `except:`. Either re-raise, log + raise, or convert to a specific exception.
- [ ] Empty query results aren't treated as success. `if not rows: return ok()` is almost always wrong on prumo — usually a missing membership check is silently hiding the data.

Why: Commit `5493631 fix(frontend): resolve 17 auto-found extraction hook + service bugs` was almost entirely error-swallow fixes. Deep dive: `references/error-swallowing.md`.

### E. Schema drift (SQLAlchemy ↔ Pydantic ↔ TypeScript)

- [ ] Every `Optional[X]` in Pydantic matches a `nullable=True` in SQLAlchemy and vice versa.
- [ ] Defaults are defined in **one** place: prefer DB-side defaults via Alembic, mirror in SQLAlchemy `server_default`, do **not** also default in Pydantic unless you mean "API will fill this in".
- [ ] Enum values are in sync between Python enum, DB type, and frontend type. New variants require a migration.
- [ ] Frontend types regenerated / updated when the response shape changes.

Why: Three of the 31 backend bugs in the auto-fix wave were schema drift. Reference: `references/schema-drift.md`.

### F. ApiResponse envelope

- [ ] Every API response uses the `ApiResponse` envelope (`{ data, ... }`) consistently. No endpoint returns the bare payload.
- [ ] Frontend unwraps **once**. If a hook returns `data.data.foo`, that's a double-unwrap bug — see `7100956 fix(qa): drop double-unwrap of ApiResponse envelope in useRunAIExtraction`.
- [ ] Mutation responses are unwrapped at the same layer as queries — pick a layer (`fetcher` vs `hook`) and stick to it. Mixed layers = bugs.

Why: Envelope inconsistency caused at least four shipped bugs. Rules: `references/api-envelope.md`.

### G. TanStack Query cache

- [ ] Cache keys include every variable that scopes the data: at minimum `project_id`, usually `run_id`, often `article_id`. Missing scope = leaks between projects.
- [ ] Mutations call `queryClient.invalidateQueries` for every list/detail key whose data they changed — not just the obvious one.
- [ ] Optimistic updates have a rollback path on error. If `onError` is empty, the cache will lie after a failed mutation.
- [ ] When the backend autoadvances a Run stage (PROPOSAL → REVIEW), the frontend invalidates the run detail key.

Why: Stale-cache bugs are silent — users see old data and assume their click failed. Cache-key playbook: `references/tanstack-cache.md`.

### H. Migrations

- [ ] Migration revision IDs match the file name. Down-revisions point to the actual previous head.
- [ ] Destructive migrations (drop column / drop table) have a documented rollback or are gated behind a feature flag.
- [ ] No data migration in the same revision as a schema migration that locks the table — split them.
- [ ] Read `docs/reference/migrations.md` before touching `backend/alembic/versions/`.

### I. Tests

- [ ] New behavior has a failing test that now passes (TDD or test-with-fix is fine; "I'll add tests later" is not).
- [ ] Bug fixes include a regression test asserting the original symptom is gone.
- [ ] No flaky `sleep`-based tests — use deterministic fixtures or `freeze_time`.
- [ ] Backend test names describe the scenario, not the code path. `test_ensure_project_member_blocks_outsider` > `test_ensure_project_member_3`.

### J. Style + meta

- [ ] All code, comments, commit messages, and PR body are in **English** (CLAUDE.md §1).
- [ ] Commit message follows **Conventional Commits** (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `perf`) with an optional scope, e.g. `fix(hitl): close session on abort`. See git log on `dev` for the in-repo style.
- [ ] PR targets `dev`, not `main`.
- [ ] PR title is the same imperative as the headline commit. PR body has the structure below.

---

## Requesting review

### Make the PR easy to review

- **Small.** One concern per PR. If you can't summarize the change in one sentence, it's two PRs.
- **Targeted at `dev`.** Never open against `main`.
- **Labeled.** Add `needs-review` (and `security` if it touches auth / RLS / endpoint exposure).
- **Self-reviewed first.** Run through the prumo checklist above before pinging anyone.

### PR body template

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

Why this template: reviewers need risk + reproduction, not a code rehash. The diff is the "what" — you owe them the "why" and the "how to verify".

### After pushing

1. Watch CI. Do not request review on a red branch.
2. Resolve your own review comments on the diff (notes for the reviewer) before pinging.
3. If the PR is non-trivial, write a "review entry point" comment: which file to read first, which is mechanical.

Full protocol: `references/requesting-review.md`.

---

## Receiving feedback

### Response pattern

`READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT`

Never skip VERIFY. The reviewer might be wrong. You owe them the courtesy of checking, not the performance of agreeing.

### Banned phrases (performative agreement)

- "You're absolutely right!"
- "Great catch!" / "Great point!"
- "Thanks for the feedback!"
- "Good idea, I'll do that."

These are social lubricant masquerading as engagement. They commit you to changes you haven't evaluated. Replace with one of the four real responses below.

### The four real responses

1. **Restate the requirement.**
   > "You're asking me to change `ensure_project_member` to a manager check on this endpoint because writes here should be manager-only — confirming."
2. **Ask a clarifying question** (when truly unclear, not as a stall).
   > "When you say 'wrap this in a transaction', do you mean the whole handler or just the two-statement state transition?"
3. **Push back with technical reasoning.**
   > "I checked `backend/app/api/v1/endpoints/extraction_runs.py:88` — `ensure_project_member` is already called. Did you have a different endpoint in mind, or am I missing a path?"
4. **Just start working** — when the request is clear, correct, and small.

### When to push back

Push back when the suggestion is:

- Factually wrong (grep proves it, link the file:line).
- More expensive than the problem (YAGNI — "we might need this someday" is not a reason now).
- In conflict with `docs/reference/extraction-hitl-architecture.md` or `docs/reference/migrations.md`.
- A style preference dressed as a correctness claim.

Push back politely with evidence, not opinion: "Here's what the code does today, here's why I picked this, what am I missing?"

### When to defer / when to fix-it-later

- **Fix now**: correctness, security, anything reviewer marked Critical.
- **Fix in this PR but in a separate commit**: Important, scope-adjacent improvements.
- **Open a follow-up issue**: Out-of-scope cleanups, "while we're here" suggestions that double the PR size.

Don't silently drop a comment. Either resolve it with a reply ("won't fix because X") or link the follow-up issue.

Full protocol: `references/receiving-feedback.md`.

---

## AI-assisted review etiquette

If an AI agent (you or another) is producing review comments:

- Every comment cites `file:line` or a command. No vague pattern-matching.
- No "consider doing X" without explaining the concrete risk if X isn't done.
- No mass-flagging style nits that the linter would catch. Make the linter catch them instead.
- The human reviewer's time is the scarcest resource — prioritize Critical → Important → Minor, in that order, and stop at the first 10 items.

If you (the agent) are receiving AI-generated review on a PR, apply the same standard: demand `file:line`, demand the concrete risk. AI review without evidence is noise.

---

## Automated PR review (cloud routine / CI / "review PR N")

Any automated surface reviewing a pull request uses this same skill as
its single source of truth: the checklist above is WHAT to review;
`references/automated-pr-review.md` is the orchestration contract —
how to identify the PR, the dedup rule, the `## Claude review` comment
format, and the comment-only hard rules. Keep review knowledge HERE,
never inlined in routine prompts or workflow files (inline copies rot;
the clone always carries the current version of this skill).

---

## Workflow integration

- **TDD / feature-dev**: review-after-each-task. Run the verification gate before saying a task is done.
- **Multi-task subagent runs**: each subagent's "done" report is unverified — re-run the gate yourself before believing it.
- **Pre-merge**: full prumo checklist + verification gate. CI green is necessary, not sufficient.
- **Hotfix on `main`**: still goes via `dev` unless explicitly approved otherwise. Hotfixes get more scrutiny, not less.

---

## Bottom line

1. **Evidence before claims.** `file:line` or command output, every time.
2. **Small PRs, full self-review, clear PR body.**
3. **Technical rigor over performative agreement.** Verify what the reviewer said. Push back when wrong. Implement when right.
4. **Run the verification gate.** No exceptions.

Verify. Question. Then implement. Evidence. Then claim.

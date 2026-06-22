---
status: draft
last_reviewed: 2026-06-22
owner: '@raphaelfh'
---

# Architecture clarity + organization gates — design

## Context & goal

prumo's architecture is well-codified (constitution §I–VIII, the `backend-development`
skill, path-scoped `.claude/rules/`, fitness functions), but the guidance is spread
across 4–5 places with overlap, the richest material (skills) is on-demand and is not
reliably loaded, the frontend has no structural pattern manual to match the backend,
and organization conventions (file size, single read-path) are not all enforced.

Goal: make it **obvious which pattern to follow** and **enforce organization with
gates**, without inflating always-loaded context. Three workstreams:
1. Canonical home + discoverability (router + de-dup).
2. Frontend structural guide (`frontend-development` skill).
3. Gates that enforce organization.

## Decision: layered hierarchy, refined (not a monolith, not always-loaded consolidation)

Researched against Anthropic's official guidance, the AGENTS.md standard, and
practitioner failure-modes (all web-verified, 2026):

- Anthropic: CLAUDE.md < 200 lines because "longer files consume more context and
  reduce adherence"; "smallest set of high-signal tokens"; the laundry-list is a named
  anti-pattern; growth path is "additive layering, NOT consolidation"; Skills use
  progressive disclosure (metadata always loaded, body on demand, references at zero
  idle cost).
- AGENTS.md standard: favors nested per-directory files; monoliths suffer silent
  truncation (Codex ≥32 KiB) and information burial; link out for depth to avoid drift.
- Failure-modes: instruction adherence decays uniformly as count rises (≈150–200
  ceiling, decay from ~80 lines) + lost-in-the-middle. **Vercel eval (decisive):** a
  skill on default auto-discovery was never invoked in 56% of cases (zero lift); an
  explicit pointer from an always-loaded file raised trigger to 95%+ (+26pp), and an
  in-context index hit 100% (+47pp).

So: keep the layers; **divide by usage pattern** — always-true *shapes* → rules;
*procedures* → skills; *mechanically checkable* → gates — plus an explicit router that
guarantees skill loading, and aggressive de-dup (single source per fact).

This layout also ports to AGENTS.md (root + nested) unchanged if cross-tool support is
ever wanted.

## Out of scope (separate spec)

Drift cleanup — splitting current god-files (`extraction_export_service.py` 2237,
`seed.py` 1941, `section_extraction_service.py` 1396; frontend `ExtractionFullScreen.tsx`
1360, `ArticlesList.tsx` 1359, `ArticleForm.tsx` 1272) and reorganizing grouped
`models/` / `schemas/`. This spec only **freezes** that drift (the file-size ratchet);
shrinking is its own spec.

---

## Workstream 1 — Canonical home, router, de-dup

### Layer roles (single source per fact)

| Layer | Owns | Loads |
|---|---|---|
| `docs/reference/constitution.md` §I–VIII | principles (the *why*), versioned | on-demand |
| `.claude/rules/{backend,frontend}.md` | non-negotiable always-true **shapes** (terse), per path | auto on path-match |
| `.claude/skills/*-development` | **procedures / pattern manuals** (the *how*) | on-demand (description + router) |
| `docs/reference/*` | deep dives (schema, migrations, deployment) | on-demand (linked) |
| `CLAUDE.md` + `llms.txt` | lean pointers + the **router** | always / navigational index |
| `.githooks/` + fitness CI | **mechanically-checkable** rules (no prose dup) | deterministic |

### 1a. `Working principles` block in CLAUDE.md

Add the following section to `CLAUDE.md` (after *Current focus*). Behavioral, always
relevant → belongs in the always-loaded layer. Adapted from a community pattern, with
prumo de-dup (points to skills, not duplicates), the surgical-vs-clean reconciliation,
and prumo-tied verification:

```markdown
## Working principles

These bias toward caution over speed. For trivial changes, use judgment.

- **Think before coding.** State assumptions; if a requirement has multiple
  readings, surface them — don't choose silently. If a simpler path exists, say
  so; push back with evidence, not deference. Genuinely unclear, or the call is
  the user's? Stop and ask — otherwise act, don't re-litigate settled choices.
  Feature/creative work starts with `superpowers:brainstorming`.
- **Simplicity first (YAGNI).** The minimum code that solves the asked problem —
  no speculative abstractions, config, or handling for impossible cases. Any
  complexity beyond what a principle prescribes must be justified (constitution
  §Governance). If 200 lines could be 50, rewrite it.
- **Surgical on unrelated code; clean in code you touch.** Change only what the
  task requires; match surrounding style; flag unrelated dead code, don't delete
  it. But where you DO edit, prefer the clean fix over grandfathering a
  violation — no new legacy left for later.
- **Goal-driven and verified.** Turn the task into a checkable goal (write the
  failing test, then make it pass). State a short plan with a verify step each.
  Evidence before "done" — run the command and read the output, never assert
  (`code-review` Iron Law; `verification-before-completion`).
```

### 1b. Skill router (the discoverability fix)

Add a compact skill map (~12–15 lines) to `CLAUDE.md` (always-loaded — this is the
explicit pointer the Vercel eval showed raises load to ~100%). Example shape:

```markdown
## Which skill to load

- Backend change (FastAPI/SQLAlchemy/Alembic/Celery/RLS) → `backend-development`
- Frontend structure/data/state (components/hooks/services/stores) → `frontend-development`
- Frontend visual language (density/layout/empty states) → `frontend-ux`
- Tailwind/shadcn class mechanics → `ui-styling`
- Before "done" / PR / review → `code-review`
- Bug / failing test → `debugging`
- Tests (Vitest/Playwright/pytest/MSW) → `web-testing`
- Deploy / promotion / rollback → `deploy-release`
```

Mirror this map navigationally in `llms.txt` (it stays a thin index; the load-guaranteeing
copy lives in always-loaded CLAUDE.md).

### 1c. Strengthen rules → skill pointers

In `.claude/rules/{backend,frontend}.md`, change soft pointers ("deep dives live in the
skill") to explicit directives: "For any non-trivial {backend,frontend} change, load the
`{backend,frontend}-development` skill before writing code." Path-scoped → fires exactly
when relevant.

### 1d. De-dup pass

Audit constitution / rules / skills for the same fact stated in >1 place. Keep: shape →
rules (terse); deep pattern → skill; principle → constitution. Remove verbatim repeats.
Delete any prose rule a hook/CI already enforces (e.g. "run ruff format" — the
PostToolUse hook + CI already do it).

### 1e. Repository-vs-service rule

Add to `rules/backend.md` + `backend-development`: "Use a repository when a query is
reused by >1 service, or the entity has several distinct query shapes; otherwise inline
`select()` in the owning service." Starting convention — refine if it causes friction.

---

## Workstream 2 — `frontend-development` skill (structural parity)

New skill `.claude/skills/frontend-development/SKILL.md` (index) + `references/*` (deep
dives, zero idle cost), mirroring `backend-development`:

- **Stack snapshot** + **repo layout to respect**: `components/{domain}/`, `pages/`,
  `hooks/{domain}/use*.ts`, `services/{domain}Service.ts`, `stores/` (Zustand),
  `contexts/`, `integrations/api/client.ts`, `lib/copy/`, `types/api/schema.d.ts`.
- **Data flow (the core):** `component → hook (TanStack Query) → service (apiClient) →
  backend`. Where each lives; what NOT to do (no `fetch`/`supabase.from` in components).
- **Shapes with examples:** component (functional, hooks-only, shadcn), hook
  (`useQuery`/`useMutation` + key-factory + invalidation), service (`{domain}Service.ts`
  returns `ErrorResult`, never throws/toasts across the boundary), store (Zustand for
  cross-component UI state; Context for app-wide singletons), form (react-hook-form + Zod).
- **Errors + React Compiler** (no try/finally in component/hook bodies; IO via
  `toResult`), **generated types** (`schema.d.ts`, never hand-mirror), **copy** (`lib/copy`).
- **Common workflows** table (add page / data-hook / mutation / form / store) +
  **references index**.

**Discoverability — non-overlapping descriptions** (the description is what triggers the
load): document the sibling boundary explicitly:
- `frontend-development` → structure / data / state / organization
- `frontend-ux` → visual language (density, header, hover, empty states)
- `ui-styling` → Tailwind/shadcn/cva mechanics (classes, `cn()`, variants)

**Rules promotion:** `rules/frontend.md` already has apiClient-only, query-key factories,
copy, React Compiler. Add the two missing structural non-negotiables: "services return
`ErrorResult`, never throw/toast across the boundary" and "data flows
component→hook→service (no fetch/supabase.from in components)."

---

## Workstream 3 — Organization gates

Verified: 8 fitness checks today; no frontend data-path gate; `check_file_size` is
WARN-only with no baseline.

### 3a. Frontend data-path gate (new fitness check)

`scripts/fitness/check_frontend_data_path.py` — flags `supabase.from(`, raw `fetch(`,
and `import.meta.env.VITE_API_URL` outside `frontend/integrations/`. Enforces
constitution §VI (single read path). Baseline grandfathers any current residual
violations (empty if clean post-#324). Ships with green-path + canary tests; wired into
`run_all.sh` and the required `fitness` CI job.

### 3b. File-size ratchet (freeze drift)

Promote `check_file_size.py` from WARN-only to a ratchet: write current oversized files
(> soft ceiling) to `check_file_size.baseline`; **fail if a baselined file grows OR a new
file crosses the ceiling**. This freezes drift now; shrinking is the separate cleanup
spec. Add a canary test, matching the other 7 checks.

### 3c. Skill-router sync check

Lightweight check (fitness or docs-ci) asserting the skill map in `CLAUDE.md` lists
exactly the skills present in `.claude/skills/` — no stale or missing entries. Keeps the
router honest, like `check_glossary_sync.py` does for the glossary.

### 3d. De-dup execution

The de-dup pass from 1d lands here as concrete edits: remove prose that a gate/hook now
owns.

---

## Acceptance criteria

- `CLAUDE.md` has `Working principles` + skill router; stays under ~150 lines.
- `rules/{backend,frontend}.md` carry explicit "load the *-development skill" directives,
  the repository-vs-service rule, and the two promoted frontend shapes; no verbatim
  duplication of skill content.
- `frontend-development` skill exists, mirrors `backend-development`, with a
  non-overlapping description and the documented sibling boundary.
- `llms.txt` mirrors the skill map navigationally; stays thin; zero rule duplication.
- `check_frontend_data_path` is a required gate (green + canary tests), baseline reflects
  reality.
- `check_file_size` is a ratchet (green + canary tests), baseline freezes current
  oversized files.
- Skill-router sync check passes.
- De-dup: a grep audit finds no prose rule that duplicates a gate/hook, and no fact
  stated verbatim in >1 layer.

## Open questions (confirm during implementation)

- Repository-vs-service threshold (">1 service / several query shapes") — starting
  convention; revisit if it mislabels real cases.
- Whether the skill-router sync check lives in `scripts/fitness/` (Python) or `docs/ci`
  (shell) — pick whichever the existing harness makes cheapest.

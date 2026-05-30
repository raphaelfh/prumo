# Linear Integration for prumo Automation Portfolio

**Status**: Design — awaiting user review (revised post-#164-merge)
**Date**: 2026-05-30
**Author**: Claude (brainstormed with raphaelfh)
**Related**: builds alongside `feat(feedback): in-app feedback → Linear (#164)`
(merged `25922fc`) — see "Coexistence" below and
`backend/app/services/linear/feedback_mapping.py`.

## Context

The prumo automation portfolio currently runs 7 Claude Code routines on Anthropic
cloud infrastructure (Pro/Max plan, zero Anthropic API consumption). These routines
detect bugs, scan CVEs, track migration drift, monitor prod health, identify flaky
tests, perform proactive cleanup, and apply approved auto-fixes — all writing to
GitHub Issues + PRs.

raphaelfh already has a Linear workspace lightly used for mental mapping. The
question raised: should we promote Linear into the automation flow for richer
triage UX (priority, project, sub-issues, mobile-first), or stay GitHub-only?

After comparing 3 approaches (GitHub-only, hybrid, Linear-first), the **hybrid
approach** was selected: GitHub remains the source of truth, Linear becomes a
visualization layer fed by native sync + a custom enrichment routine. Linear's
built-in AI Agent (US$8/month) is replaced by a Claude Code routine using Linear
MCP, leveraging the existing Pro/Max plan quota.

### Coexistence with the merged in-app feedback flow (PR #164)

A separate, already-merged feature (`feat(feedback): in-app feedback → Linear
one-way intake (#164)`, commit `25922fc`) sends **user-submitted** feedback
directly to the same Linear team (**Prumo / `PRU`**, workspace `prumo-ai`) via
backend GraphQL — **not** through GitHub. This creates a **second, independent
path into Linear** that our automation must coexist with rather than collide
with. This spec was revised after #164 merged to align on three points:

1. **Two paths, one Triage.** Feedback issues are born in Linear (backend →
   GraphQL). Automation issues are born in GitHub (routine → `gh issue` → native
   sync → Linear). Both land in the PRU **Triage** inbox.
2. **Source labels separate them.** #164 stamps every user report with
   `source:in-app`. Our automation issues must carry `source:automation` so the
   team can filter the two streams apart in one inbox.
3. **Shared `area:*` taxonomy, not invented Projects.** #164 established the
   team's label scheme (`Bug`/`Feature`/`Question`, `area:pdf|extraction|ui-ux|
   database|multi-user|multi-provider`, `priority:*`). Our earlier draft invented
   Linear *Projects* ("Backend Services", "Frontend") for grouping — that clashes
   with the established convention. We now reuse the existing `area:*` labels so a
   filter like "everything touching the PDF viewer" spans both feedback and
   automation.

The reference is the merged mapping at
[`backend/app/services/linear/feedback_mapping.py`](../../../backend/app/services/linear/feedback_mapping.py).

## Goals

1. Add Linear as a visualization/triage layer with **minimal change to the 7
   existing routines** (the 5 proactive ones gain two labels in their
   `gh issue create` calls; logic unchanged)
2. Use **Linear MCP via Claude Code routine** for enrichment (summarize + set the
   **native Linear priority field** that label-sync cannot set) — bypass the
   US$8/month Linear AI Agent
3. **Coexist cleanly with the merged feedback flow (#164)** — `source:automation`
   vs `source:in-app`, shared `area:*` labels, no Linear Projects invented
4. Keep approval flow flexible: GitHub label (current) **or** Linear status change
   (via sync) — user picks daily what feels faster
5. Reversible in 3 stages — any phase can be undone without affecting the
   automation portfolio or the feedback flow

## Non-goals

- Migrate GitHub Issues to Linear as source of truth
- Replace GitHub as the hub for PRs / code / CI
- Pay for Linear Plus (US$8/month) — replaced by Claude Code routine
- Implement Linear → routine webhook (Linear cannot natively trigger Claude Code
  routines; would require custom infra. Out of scope.)
- Touch the merged feedback flow (#164) — its backend, GraphQL client, and
  `source:in-app` issues are out of scope; `linear-enrich` explicitly skips them
- Invent new Linear Projects or `area:*` labels beyond the #164 taxonomy (the one
  exception, `area:api`, was considered and **rejected** — no confident
  scope→area mapping for cross-cutting API work; those issues carry
  `source:automation` + `scope:api` only)

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│  PRODUCTION: Railway + Vercel + Supabase                            │
└────────────────────────────▲────────────────────────────────────────┘
                             │ (cron probes from system-health-check)
                             │
┌────────────────────────────┴────────────────────────────────────────┐
│  8 ROUTINES (Anthropic Cloud — Pro/Max plan, no API)                │
│                                                                      │
│  Proactive cron (5):  system-health-check, dep-vuln-sweep,          │
│                       migration-drift-detector, bug-watch,           │
│                       flaky-test-tracker                             │
│  Hybrid (1):          cleanup (cron + label tech-debt)              │
│  Reactive (1):        bug-watch-write (label auto-fix-approved)     │
│  ✨ NEW (1):          linear-enrich (cron daily)                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ writes
                             ▼
┌──────────────────────────┐    Linear-GitHub native sync   ┌─────────────────────┐
│  GitHub Issues + PRs     │ ────────── 1-way ────────────► │  Linear (PRU team)  │
│  (source of truth)       │ ◄──── comments bidirectional   │  Triage inbox       │
│                          │                                 │                     │
│  auto-found, scope:*,    │                                 │  PATH A (automation)│
│  area:*, source:auto,    │                                 │   source:automation │
│  priority:* labels       │                                 │   + area:* + scope:*│
└──────────────────────────┘                                 │   → linear-enrich   │
              ▲                                              │     sets NATIVE     │
              │ (3 taps: label apply)                        │     priority field +│
┌─────────────┴────────────┐                                 │     summary comment │
│  Developer (mobile)      │ ── or Linear Mobile ──┐         │                     │
│  • GitHub Mobile         │                       │         │  PATH B (feedback   │
│  • Linear Mobile         │                       └────────►│   = PR #164)        │
└──────────────────────────┘                                 │   source:in-app;    │
                                                             │   priority + area   │
┌──────────────────────────┐  backend GraphQL (direct,       │   set by backend.   │
│ In-app feedback (#164)   │ ── NOT via GitHub) ───────────► │   linear-enrich     │
│ user → /api/v1/feedback  │                                 │   SKIPS these       │
└──────────────────────────┘                                 └─────────────────────┘
```

**Key**: Path A and Path B both land in the PRU Triage but never collide —
`linear-enrich` filters on `source:automation` and skips `source:in-app`. Native
Linear priority is set by `linear-enrich` for Path A (label-sync can't set the
native field) and by the backend GraphQL call for Path B.

## Components

### 1. Linear-GitHub native sync (zero code)

**Provider**: Linear's GitHub integration (free tier OK)
**Direction**: 1-way (`GitHub Issues → Linear`) + comments bidirectional + PR linking
**Setup**: Linear UI → Settings → Integrations → GitHub → Connect
**Label mapping**: Linear's GitHub sync matches labels **by name**. To reuse the
`area:*` labels #164 already created in Linear, the **same names must exist on
GitHub** so a routine can apply them and sync will map to the existing Linear
label (not create a duplicate). Labels carried across:
- prumo-internal: `auto-found`, `scope:*`, `priority:*`, `tech-debt`,
  `flaky-test`, `prod-incident`, `dep-vuln`, `migration-drift`
- **new (mirror Linear / #164 taxonomy)**: `source:automation`, `area:extraction`,
  `area:ui-ux`, `area:database`

**Latency**: ~30s per event

### 2. Routine `linear-enrich` (new, 8th)

**Purpose**: Set the **native Linear priority field** on automation tickets (the
one thing label-sync cannot do) + add a one-line AI summary. Replaces Linear AI
Agent using Claude Code via Linear MCP.

**Schedule**: cron `0 14 * * *` UTC (daily 11:00 GMT-3, after all morning routines)
**Quota**: 1 run/day (total cron baseline: 1.7 → 2.7/day, fits Pro 5/day)
**MCPs**: Linear (already connected at claude.ai)
**Allowed tools**: `Bash, Read, Glob, Grep` (no code mutations, no GitHub writes)

**Why it exists** (the gap): native sync maps GitHub labels → Linear labels, but
a GitHub `priority:P1` label syncs as a *label*, not the Linear **native priority
field** (the int 0–4 that orders the inbox). #164's feedback flow sets that
native field via GraphQL; automation tickets arriving via sync have it unset.
`linear-enrich` fills exactly that gap. The `area:*` grouping is already handled
by the labels the routines apply (synced natively) — `linear-enrich` does not
touch area unless backfilling a missing one.

**Behavior** (prompt summary):

1. Query Linear (PRU team) for issues created in the last 30h that carry
   **`source:automation`** (or are unlabeled-source legacy from sync) AND match a
   prumo routine title prefix (`bug(`, `prod-incident:`, `dep-vuln:`,
   `migration-drift:`, `flaky-test:`).
2. **Skip — defense in depth:**
   - `source:in-app` present → **skip** (that is #164's feedback; backend already
     set its priority + area + summary). This is the critical coexistence guard.
   - Already has a comment starting with `AI Summary (linear-enrich):` → skip (dedup).
   - Native priority already set (≠ No priority) → skip (human already triaged).
3. Parse the synced body / labels:
   - `priority:P0` → Urgent (1); `priority:P1` → High (2); else read `## Severity`
     H2 → high→High(2), med→Medium(3), low→Low(4). Mirrors #164's
     `_PRIORITY_BY_SEVERITY` ordering exactly.
   - `## Summary` / first paragraph → 1–2 sentence TL;DR.
4. Update ticket via Linear MCP:
   - `update-tasks` / `save-issue`: set the **native priority field** only.
   - (best-effort) if no `area:*` label present, infer from `scope:*` and add it:
     `scope:models|migrations` → `area:database`; `scope:components|hooks|pages`
     → `area:ui-ux`; `scope:services` → `area:extraction` **only if** the cited
     path matches `extraction_*`; `scope:api` → skip (no confident area).
   - `save-comment`: append `AI Summary (linear-enrich): <TL;DR> | Priority: <X>
     from <priority:P1 | ## Severity>`.
5. Hard limits:
   - Max 10 tickets enriched per run
   - **NEVER** sets a Linear *Project* (the earlier draft's mistake — Projects are
     for roadmap, not code-area grouping; `area:*` labels do that)
   - **NEVER** modifies title or description (preserves sync source integrity)
   - **NEVER** creates or deletes tickets
   - **NEVER** touches `source:in-app` tickets or tickets without a routine prefix

### 3. Existing routines: 5 proactive ones gain 2 labels

The 5 proactive routines (`system-health-check`, `dep-vuln-sweep`,
`migration-drift-detector`, `bug-watch`, `flaky-test-tracker`) get a **prompt
update** (via `RemoteTrigger update`) so their `gh issue create --label` calls
add:
- **`source:automation`** (always — the coexistence guard vs `source:in-app`)
- best-effort **`area:*`** from the issue's scope (same mapping as §2.4; skip when
  not confident, mirroring #164's `area_label_for` returning `None`)

`scope:*` labels stay (prumo-internal). Logic, schedule, and MCPs are otherwise
unchanged. The 2 PR-opening routines (`cleanup`, `bug-watch-write`) open PRs, not
issues, so they need no label change.

## Data flow (canonical scenario)

Saturday 03h UTC:
1. `bug-watch` cron fires → opens 3 GitHub issues labeled `auto-found,
   scope:services, source:automation, area:extraction, priority:P1`
2. Linear-GitHub sync replicates 3 tickets to Linear within ~30s. Labels map by
   name to the existing PRU `area:extraction` / `priority:P1` labels. Native
   priority field is still **unset** (sync only carried the label).

Saturday 14h UTC (`linear-enrich` cron):
3. `linear-enrich` queries PRU for `source:automation` tickets, finds the 3
   (skips any `source:in-app` feedback tickets entirely)
4. For each: reads `priority:P1` label → sets **native priority = High (2)**;
   generates 1–2 sentence TL;DR
5. Updates each ticket: native priority field + `AI Summary (linear-enrich): …`
   comment. Area already present from the synced label — left as-is.

Saturday 09h GMT-3 (user wakes up):
6. User opens Linear Mobile → sees priority-ordered inbox (native priority now
   sorts them), feedback (`source:in-app`) and automation (`source:automation`)
   filterable apart
7. Picks Urgent ticket, reads TL;DR + body
8. Approves → applies `auto-fix-approved` label (in GH or in Linear; sync mirrors)
9. `bug-watch-write` routine fires via GitHub event trigger → opens draft PR
10. CI runs on PR → `Auto-fix` watches → user reviews + merges

## Error handling

| Failure | Behavior |
|---|---|
| Linear MCP unavailable | `linear-enrich` exits with `linear_enrich_done error=mcp-unavailable analyzed=0`. No GitHub issue created (enrichment is non-critical). Next day retries. |
| Ticket body has no parseable priority/severity | Skip with `skipped_unparseable++` counter; log issue identifier |
| `area:*` label missing AND scope→area not confident | Leave area unset (mirrors #164's `area_label_for → None`); never blocks priority-setting |
| `source:in-app` ticket encountered | **Skip** with `skipped_feedback++` counter (coexistence guard — #164 owns these) |
| Sync delay > 30h (edge case) | `linear-enrich` next run picks it up next day; no data loss |
| Routine times out (>15min) | Process partial; output line still emitted |
| User manually sets native priority before routine runs | Routine sees priority set → skip (human won) |

## Testing

### Validation script (manual, after each rollout phase)

**Phase 1 (labels + sync activated)**:
```bash
# Create the mirror labels on GitHub (so sync maps to existing Linear area:* labels)
gh label create "source:automation" --color ededed -R raphaelfh/prumo
gh label create "area:extraction"   --color 0e8a16 -R raphaelfh/prumo
gh label create "area:ui-ux"        --color 1d76db -R raphaelfh/prumo
gh label create "area:database"     --color d4c5f9 -R raphaelfh/prumo

# Create test issue via GitHub
gh issue create -R raphaelfh/prumo --title "test: linear sync validation" \
  --label auto-found,scope:services,source:automation,area:extraction,priority:P1 \
  --body "## Severity\nhigh\n\n## File & Lines\nbackend/app/services/foo.py:42"
# Wait 60s
# Check Linear UI manually — ticket should appear in PRU with area:extraction +
# priority:P1 labels mapped to the EXISTING Linear labels (no duplicates created)
```

**Phase 2 (linear-enrich created)**:
```bash
# Manually trigger via RemoteTrigger run linear-enrich
# Confirm:
# - Linear ticket from Phase 1 now has NATIVE priority = High (from priority:P1)
# - area:extraction already present (from sync), left as-is
# - New comment "AI Summary (linear-enrich): ... | Priority: High from priority:P1"
# - A source:in-app feedback ticket (from #164) is NOT touched
# - Output line: linear_enrich_done analyzed=1 enriched=1 skipped_dup=0 skipped_feedback=0 skipped_humantried=0
```

**Phase 3 (production)**:
- Let `linear-enrich` run autonomously for 1 week
- Monitor Linear inbox: every `source:automation` ticket should have native
  priority set + AI Summary comment within 24h; every `source:in-app` ticket
  should remain untouched by `linear-enrich`
- If user manually sets native priority before routine → routine respects it
  (defense in depth verification)

## Rollout (3 reversible phases)

| Phase | Who | What | Reversible? |
|---|---|---|---|
| 0 — Labels | Claude (`gh label create`) | Create `source:automation`, `area:extraction`, `area:ui-ux`, `area:database` on GitHub | Delete labels |
| 1a — Routine prompt update | Claude (`RemoteTrigger update`) | 5 proactive routines add `source:automation` + best-effort `area:*` to `gh issue create` | Revert prompt |
| 1b — Native sync | User (Linear UI) | Connect Linear-GitHub, configure 1-way sync + by-name label mapping | Disconnect = back to status quo |
| 2 — Routine `linear-enrich` | Claude (`RemoteTrigger create`) | Create 8th routine, schedule daily, attach Linear MCP | Disable via UI; existing tickets keep enrichment |
| 3 — User adoption | User | Start triaging via Linear Mobile some days; compare with GitHub Mobile flow | Stop using; no system effect |

## Alternatives considered

| Option | Why discarded |
|---|---|
| **GitHub-only** (status quo) | User explicitly asked about Linear → wants the visual layer; ignoring would be too conservative |
| **Linear-first** (routines write to Linear) | Requires re-prompting all 7 routines + building Linear→routine webhook handler (~3-5h work) + breaks reversibility. #164 already proved the direct-GraphQL path works for feedback, but adopting it for automation would duplicate that infra in routine prompts |
| **Linear AI Agent built-in** (US$8/month Plus) | Functionally redundant with Claude Code routine using Linear MCP; routine cost is included in existing Pro/Max plan |
| **Linear → routine webhook trigger** (via Vercel Function intermediary) | Linear cannot natively trigger Claude Code routines; intermediary adds 100+ LoC and another moving part for marginal gain over GitHub label trigger |
| **Bidirectional sync (Linear → GH)** | Would create duplicate issues if user opens Linear tickets manually; 1-way is safer for solo dev workflow |

## Open questions / risks

1. **Coexistence with #164 (highest)**: if `linear-enrich`'s `source:in-app` skip
   guard fails, it could overwrite the native priority the feedback backend
   already set, or comment-spam user reports. Mitigation: the skip is the **first**
   filter (step 2), tested explicitly in Phase 2 validation (a `source:in-app`
   ticket must remain untouched), and counted in output (`skipped_feedback`).
2. **Label name drift**: sync matches `area:*` by name. If #164's Linear labels
   are ever renamed, the GitHub mirror labels won't map and sync silently creates
   duplicates. Mitigation: the mirror set is small (4 labels); document them next
   to #164's `feedback_mapping.py` `_AREA_RULES` so a rename touches both.
3. **Comment noise**: 1 comment per ticket per enrichment run could clutter.
   Mitigation: dedup marker — skip if any prior comment starts with `AI Summary
   (linear-enrich):`.
4. **Sync race conditions**: ticket might appear in Linear before all labels
   sync. Mitigation: routine runs at 14:00 UTC, giving the 03:00 UTC bug-watch
   batch 11 hours to fully sync.
5. **Linear Free tier limit**: 250 issues + 10 users, now shared with #164's
   feedback issues. At ~30 automation + low feedback volume/month, still months of
   runway. Plan to archive completed tickets quarterly.

## Next steps

1. Atualizar plan file (`/Users/raphael/.claude/plans/glittery-crafting-river.md`) — done
2. Spec revised post-#164-merge (3 adjustments: source distinction, area labels,
   native-priority enrich) — done
3. User review this spec
4. Invoke `writing-plans` skill to create execution plan covering:
   - Phase 0: create 4 mirror labels on GitHub (`gh label create`)
   - Phase 1a: update 5 proactive routine prompts (`RemoteTrigger update`)
   - Phase 1b: native sync (Linear UI work — user does)
   - Phase 2: routine `linear-enrich` creation (`RemoteTrigger create` — Claude does)
   - Phase 3: validation (end-to-end test, incl. `source:in-app` skip guard)
5. Execute the plan

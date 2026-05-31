---
status: implemented
last_reviewed: 2026-05-31
owner: '@raphaelfh'
---

# Linear Integration for prumo Automation Portfolio

**Status**: Implemented & validated 2026-05-31 (as-built)
**Date**: 2026-05-30 (design) → 2026-05-31 (built + hardened)
**Author**: Claude (brainstormed + executed with raphaelfh)
**Related**: coexists with `feat(feedback): in-app feedback → Linear (#164)`
(merged `25922fc`) — see "Coexistence" and `backend/app/services/linear/feedback_mapping.py`.

## Context

The prumo automation portfolio runs Claude Code routines on Anthropic cloud
(Pro/Max plan, **zero Anthropic API consumption**) that detect bugs, scan CVEs,
track migration drift, monitor prod health, find flaky tests, do proactive
cleanup, and apply approved auto-fixes — writing to GitHub Issues + PRs.

This work promotes **Linear** into the flow as a rich triage layer (native
priority, mobile-first inbox) without making it the source of truth, and adds
**meta-monitoring** so the portfolio watches itself.

GitHub stays the source of truth. Linear is fed by native GitHub Issue Sync and
enriched by a dedicated routine that sets the one thing label-sync can't: the
**native Linear priority field**.

### Coexistence with the in-app feedback flow (PR #164)

#164 sends **user-submitted** feedback to Linear via backend GraphQL (not GitHub).
Originally it posted to the **Prumo** team — colliding with our automation path.
**Resolved by team separation** (the primary isolation):

- **Prumo team** ↔ GitHub (one-way sync) → **automation** lives here.
- **Feedback team** (id `23d83039-4f9a-444f-905a-9a4cb9fea2b6`, **no** GitHub sync)
  → **user feedback** lives here. Set via env: `LINEAR_TEAM_ID=23d83039-...`
  (read in `feedback_tasks.py:59`; no code change — config only).

Linear's GitHub Issue Sync links **one team only**, so pointing it at Prumo while
#164 posts to Feedback cleanly separates the two streams. `source:automation` vs
`source:in-app` labels remain as a **defensive second layer**.

## Goals (all met)

1. Linear as a triage layer with minimal change to existing routines.
2. **Native Linear priority** set by Claude Code (Linear MCP), bypassing the
   US$8/month Linear AI Agent.
3. Clean coexistence with #164 via **team separation** + source labels.
4. **Meta-monitoring**: a heartbeat log + watchdog so a silently-dead routine is
   detected, not discovered weeks later.
5. Reversible in stages.

## Non-goals

- Migrate GitHub Issues to Linear as source of truth.
- Two-way Prumo↔GitHub sync — **rejected**: it would mirror every new Prumo ticket
  (incl. the "Review Hub - Roadmap 2026" project) to the **public** GitHub repo.
  Approval is done in GitHub Mobile instead (one deliberate tap).
- Pay for Linear Plus — replaced by `linear-enrich`.
- Linear → routine webhook (Linear can't natively trigger routines).
- New Linear Projects or `area:*` labels beyond #164's taxonomy (`area:api` was
  considered and rejected — no confident scope→area mapping; those issues carry
  `source:automation` + `scope:api` only).

## Architecture (as-built, 9 routines)

```text
┌─────────────────────────────────────────────────────────────────────┐
│  PRODUCTION: Railway + Vercel + Supabase                            │
└────────────────────────────▲────────────────────────────────────────┘
                             │ (cron probes — system-health-check)
┌────────────────────────────┴────────────────────────────────────────┐
│  9 ROUTINES (Anthropic Cloud — Pro/Max plan, no API)                │
│  Proactive cron (5):  system-health-check, dep-vuln-sweep,          │
│                       migration-drift-detector, bug-watch,           │
│                       flaky-test-tracker                             │
│  Hybrid (1):          cleanup (cron + label tech-debt)              │
│  Reactive (1):        bug-watch-write (label auto-fix-approved)     │
│  Enrich (1):          linear-enrich (cron daily)                    │
│  Meta (1):            routine-watchdog (cron Sun) ──┐ reads heartbeat│
└──────┬──────────────────────────────────────────────┼───────────────┘
       │ writes issues + heartbeat                     │
       ▼                                               ▼
┌──────────────────────────┐  one-way   ┌──────────────────────────────┐
│  GitHub Issues + PRs     │ ─────────► │  Linear · Prumo (PRU) team    │
│  (source of truth)       │ ◄ comments │  source:automation + area:*   │
│  + 🤖 Heartbeat #171     │            │  → linear-enrich sets NATIVE  │
└──────────────────────────┘            │    priority + summary         │
       ▲ (approve = 3 taps GitHub Mobile)│  (prod-incident: Urgent set  │
       │                                 │   INLINE by health-check)     │
┌──────┴───────────────────┐            └──────────────────────────────┘
│ Developer (GitHub Mobile  │            ┌──────────────────────────────┐
│  + Linear Mobile to read) │            │  Linear · Feedback team       │
└──────────────────────────┘            │  source:in-app (#164, no sync)│
┌──────────────────────────┐ GraphQL    │  priority+area set by backend │
│ In-app feedback (#164)   │ ─────────► │  linear-enrich never queries  │
│ user → /api/v1/feedback  │            │  this team                    │
└──────────────────────────┘            └──────────────────────────────┘
```

**Isolation is structural**: feedback and automation live in **different Linear
teams**. `linear-enrich` only queries the Prumo team; it can't even see feedback.

## Components

### 1. Linear GitHub Issue Sync (one-way, zero code)

⚠ **Setup gotcha (learned in build):** this is a **separate sub-config**, not the
base GitHub integration. The base integration only links PRs/branches and does
**not** mirror issues. Enable it at: Linear → Settings → Integrations → GitHub →
the **"GitHub Issues"** section → **`+`** → pick repo `raphaelfh/prumo` + team
**Prumo** → **One-way** (`GitHub Issues → Linear`).

- **Direction**: one-way (GitHub→Linear) + comments bidirectional.
- **Labels**: matched **by name**. The mirror labels created on GitHub
  (`source:automation`, `area:extraction`, `area:ui-ux`, `area:database`) map onto
  the existing Linear labels #164 created — no duplicates.
- **Latency**: ~30–60s per event (validated).
- **Native priority is NOT carried** — sync brings the `priority:P1` *label*, not
  the native field. That gap is what `linear-enrich` fills.

### 2. Routine `linear-enrich` (cron daily, `trig_01ACDzcTqifSTmpTyHk8SQn1`)

Sets the **native Linear priority field** on Prumo-team automation tickets + adds
a one-line AI summary. **Schedule** `0 14 * * *`. **MCP**: Linear only.

- **Selection**: tickets in the **Prumo team** created in the last 30h carrying
  the **`source:automation` label** (robust signal — title-prefix filtering was
  dropped so future routines with new title formats are still enriched).
- **Skip (defense in depth)**: `source:in-app` (belt-and-suspenders — feedback is
  already in a different team), prior `AI Summary (linear-enrich):` comment (dedup),
  native priority already set (human OR system-health-check already did it).
- **Priority map** (mirrors #164 `_PRIORITY_BY_SEVERITY`): `priority:P0`→Urgent(1),
  `priority:P1`→High(2), else `## Severity` high/med/low→High/Medium/Low.
- **Writes** via Linear MCP (`save_issue` priority field, `save_comment`); the only
  `gh` write is the heartbeat. Never sets a Linear Project, never edits
  title/description, never creates/deletes tickets.

### 3. `system-health-check` — inline Urgent for prod-incident (low-latency path)

`prod-incident` is the most urgent class and must not wait for the 14:00 enrich
batch. After filing the GitHub issue, `system-health-check` (now also holding the
Linear MCP) polls Linear ~90s for the synced ticket and sets native priority
**Urgent(1)** immediately, stamping the `AI Summary (linear-enrich):` dedup marker
so the batch skips it. If not synced within 90s, it defers to the daily batch
(graceful degradation; `linear_priority=deferred` in output).

### 4. Meta-monitoring: heartbeat + `routine-watchdog`

**Heartbeat log**: pinned GitHub issue **#171** (`🤖 Automation Heartbeat`, label
`meta:heartbeat`). Every cron routine, as its final step, posts
`<name> OK <UTC ts> | <summary>` — **always**, even on nothing-to-do.

**`routine-watchdog`** (`trig_015kZDzu7hghSzrPEQcznPbb`, cron `0 18 * * 0`,
Sunday): reads #171, builds a per-routine last-seen map, and opens ONE
`automation-watchdog:` alert issue if any of the 6 cron routines is **silent**
(older than its max gap: daily→2d, weekly→9d) or **erroring** (`error=`,
`mcp-unavailable`, `baseline red`, …). A 9-day bootstrap grace avoids rollout
false alarms. No MCP — reads GitHub via `gh`. It heartbeats itself too.

> Why heartbeat-via-issue, not OAuth-token: a routine can't call the claude.ai
> triggers API without the user's long-lived OAuth token, and storing that in a
> routine env contradicts the project's own secret-leak posture. The heartbeat
> approach exposes no credential.

### 5. The 5 proactive routines: 2 labels + heartbeat

Each gains `source:automation` (always) + best-effort `area:*` on `gh issue
create`, and the heartbeat step. `scope:*` stays. The 2 PR-opening routines
(`cleanup`, `bug-watch-write`) open PRs not issues, so no label change; they're
event-driven and observable via PR/label activity (not in the heartbeat set).

## Routine inventory (as-built)

| Routine | ID | Trigger | Heartbeat | MCP |
|---|---|---|---|---|
| system-health-check | `trig_01FhDpFrJJtvz43qh9EY9NQB` | cron `0 12 * * *` | ✓ | Vercel+Supabase+Linear |
| dep-vuln-sweep | `trig_01QL2qyan1t6pBqJRdwneg8X` | cron `0 16 * * 1` | ✓ | — |
| migration-drift-detector | `trig_01HHfcKmJTnjn2AiqrUrSqzF` | cron `0 10 * * 1` | ✓ | Supabase |
| bug-watch | `trig_01GtuwTpuQMFTcxVE6WEotvy` | cron `0 6 * * 6` | ✓ | — |
| flaky-test-tracker | `trig_01UA3zyf53r7BEfQgppxtzrp` | cron `0 13 * * 1` | ✓ | — |
| cleanup | `trig_01YBm1YjAd18JdZDe8thsPCd` | cron `0 9 * * 2` + label `tech-debt` | — | — |
| bug-watch-write | `trig_01T8PF56S19cJ5iKusnQwuZF` | label `auto-fix-approved` | — | — |
| linear-enrich | `trig_01ACDzcTqifSTmpTyHk8SQn1` | cron `0 14 * * *` | ✓ | Linear |
| routine-watchdog | `trig_015kZDzu7hghSzrPEQcznPbb` | cron `0 18 * * 0` | ✓ (self) | — |

**Cron quota**: ~2.9 runs/day (2 daily + ~0.9 weekly-amortized). Event-driven
routines don't count. Fits Pro (5/day) with headroom.

## Data flow (canonical)

1. Sat 03h — `bug-watch` opens GitHub issues labeled `auto-found, scope:services,
   source:automation, area:extraction, priority:P1`; posts heartbeat to #171.
2. +~60s — sync mirrors them into the Prumo team (labels by name; native priority
   still unset).
3. Sat 14h — `linear-enrich` finds them by `source:automation`, sets native
   priority High, adds AI Summary; posts heartbeat.
   (A `prod-incident` would already be **Urgent** — set inline by health-check.)
4. Sun morning — user opens **Linear Mobile**, sees a priority-ordered inbox.
5. To approve a fix: apply `auto-fix-approved` in **GitHub Mobile** (one-way sync
   means Linear-side labels don't propagate) → `bug-watch-write` fires → draft PR
   → Auto-fix watches CI → review + merge.
6. Sun 18h — `routine-watchdog` confirms all 6 cron routines checked in; silent → alert.

## Error handling

| Failure | Behavior |
|---|---|
| Linear MCP unavailable | enrich posts heartbeat, exits `error=mcp-unavailable`; daily retry; watchdog flags if repeated |
| prod-incident ticket not synced in 90s | health-check defers to daily enrich (`linear_priority=deferred`) |
| Routine silently dies | no heartbeat → watchdog opens `automation-watchdog:` alert after max-gap |
| `source:in-app` seen by enrich | skipped (team separation makes this near-impossible; label guard is backup) |
| Sync delay > 30h | enrich next run picks it up |
| Human sets native priority first | enrich skips (human won) |

## Validation (done 2026-05-31)

- **Sync**: GitHub #167 → Prumo `PRU-23` with all labels mapped (no dup `area:*`).
- **Native priority gap**: PRU-23 arrived `No priority`; `linear-enrich` set it to
  **High(2)** + `AI Summary (linear-enrich): … | Priority: High from priority:P1`.
- **Skip guard**: `PRU-24` (`source:in-app` + `bug(` prefix + Urgent) left
  **untouched** by enrich.
- Test issues #166/#167/#169 closed; `source:in-app` Linear label created
  (id `726332cb`, #164 reuses by name).
- Pending re-validation after Feedback-team switch: confirm a feedback submit
  lands in the Feedback team (after `LINEAR_TEAM_ID` is updated on Railway).

## Rollout (all reversible)

| Phase | Who | What | Undo |
|---|---|---|---|
| 0 — Labels | Claude | 4 GitHub mirror labels + `meta:heartbeat` | delete labels |
| 1a — Prompts | Claude | 5 proactive + enrich gain `source:automation`/`area:*`/heartbeat; health-check gains inline Urgent | revert prompt |
| 1b — Sync | User | Linear GitHub **Issues** sync, Prumo, one-way | disconnect |
| 1c — Team split | User | `LINEAR_TEAM_ID` → Feedback team on Railway + `.env` | revert env var |
| 2 — Routines | Claude | `linear-enrich` + `routine-watchdog` + heartbeat #171 | disable in UI |
| 3 — Adoption | User | triage in Linear, approve in GitHub Mobile | stop using |

## Open risks

1. **Feedback-team env not yet switched** (highest open item): until
   `LINEAR_TEAM_ID` is updated on Railway, feedback still posts to Prumo. Action:
   set `LINEAR_TEAM_ID=23d83039-4f9a-444f-905a-9a4cb9fea2b6` on Railway + `.env`.
2. **Heartbeat issue syncs to Linear** as one Prumo ticket (noise). It lacks
   `source:automation` so enrich ignores it; archive the Linear mirror once.
3. **Label-name drift**: sync matches `area:*` by name; a rename in #164's Linear
   labels would orphan the GitHub mirrors. Keep the 4-label mirror set documented
   beside `feedback_mapping.py` `_AREA_RULES`.
4. **Heartbeat comment volume**: ~40/week on #171; prune annually.
5. **Set-once priority**: enrich won't re-run on a ticket whose priority is set, so
   a later GitHub `priority:P1→P0` relabel isn't reflected (acceptable for triage).
6. **MCP over-provisioning**: `RemoteTrigger create` attaches all connectors;
   always re-assert intended MCPs after create (pattern used for enrich + watchdog).

## Maintenance notes

- Editing the scope→area map means updating it in **4 places** (bug-watch,
  flaky-test-tracker, linear-enrich, + this doc) — routines can't share code.
- To extend the watchdog to a new cron routine: add it to the §2 cadence list in
  the `routine-watchdog` prompt and ensure that routine posts a heartbeat.

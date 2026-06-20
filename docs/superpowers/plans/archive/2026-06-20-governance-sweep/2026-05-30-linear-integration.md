---
status: shipped
last_reviewed: 2026-05-31
owner: '@raphaelfh'
---

# Linear Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the prumo automation portfolio (7 routines on GitHub Issues) into the Linear PRU team as a rich triage layer, coexisting cleanly with the merged in-app-feedback→Linear flow (PR #164).

**Architecture:** GitHub stays source of truth. The 5 proactive routines stamp `source:automation` + best-effort `area:*` labels on issues. Linear's native GitHub sync mirrors those issues into the PRU Triage. A new daily `linear-enrich` routine sets the **native Linear priority field** (the one thing label-sync can't do) and adds a one-line summary — while skipping `source:in-app` feedback tickets entirely.

**Tech Stack:** Claude Code Routines (Anthropic cloud, Pro/Max plan), `RemoteTrigger` tool (claude.ai routines API), GitHub CLI (`gh`), Linear GitHub integration (native sync), Linear MCP (`mcp.linear.app`).

**Spec:** `docs/superpowers/specs/2026-05-30-linear-integration-design.md`

**Reference (must coexist with):** `backend/app/services/linear/feedback_mapping.py` (PR #164, merged `25922fc`).

---

## Reference: routine IDs (from glittery-crafting-river.md)

| Routine | ID | Role in this plan |
| --- | --- | --- |
| system-health-check | `trig_01FhDpFrJJtvz43qh9EY9NQB` | prompt update (Phase 1a) |
| dep-vuln-sweep | `trig_01QL2qyan1t6pBqJRdwneg8X` | prompt update (Phase 1a) |
| migration-drift-detector | `trig_01HHfcKmJTnjn2AiqrUrSqzF` | prompt update (Phase 1a) |
| bug-watch | `trig_01GtuwTpuQMFTcxVE6WEotvy` | prompt update (Phase 1a) |
| flaky-test-tracker | `trig_01UA3zyf53r7BEfQgppxtzrp` | prompt update (Phase 1a) |
| cleanup | `trig_01YBm1YjAd18JdZDe8thsPCd` | unchanged (opens PRs) |
| bug-watch-write | `trig_01T8PF56S19cJ5iKusnQwuZF` | unchanged (opens PRs) |

**Linear MCP connector:** `connector_uuid: 191572ab-93df-4f8f-b20d-aa0923b96a9f`, `name: Linear`, `url: https://mcp.linear.app/mcp`

**Environment:** `env_012ibsp8thFCLZohEdPXqcU9` (prumo-cloud)

---

## RemoteTrigger update mechanics (read before Phase 1a)

To change a routine's **prompt**, you must re-send the full `job_config.ccr` (the
API replaces `ccr` wholesale; a partial `events`-only payload would drop
`session_context`, `sources`, and `environment_id`). The safe pattern for every
prompt update:

1. `RemoteTrigger {action: "get", trigger_id: "<id>"}` → read the full
   `job_config.ccr` object.
2. In `events[0].data.message.content`, replace ONLY the exact label-line
   substring given in the task.
3. `RemoteTrigger {action: "update", trigger_id: "<id>", body: {job_config: {ccr: <full ccr with modified content>}}}`.
4. `RemoteTrigger {action: "get", trigger_id: "<id>"}` → confirm the new label
   line is present and `session_context.allowed_tools` / `sources` are intact.

Do NOT hand-retype the whole prompt. Fetch → surgical string replace → send back.

---

## Phase 0 — GitHub mirror labels

### Task 1: Create the 4 mirror labels on GitHub

**Files:** none (GitHub repo state via `gh`).

- [ ] **Step 1: Create the labels**

```bash
gh label create "source:automation" --color ededed --description "Issue created by an automation routine (vs source:in-app feedback)" -R raphaelfh/prumo
gh label create "area:extraction"   --color 0e8a16 --description "Mirrors Linear area:extraction (PR #164 taxonomy)" -R raphaelfh/prumo
gh label create "area:ui-ux"        --color 1d76db --description "Mirrors Linear area:ui-ux (PR #164 taxonomy)" -R raphaelfh/prumo
gh label create "area:database"     --color d4c5f9 --description "Mirrors Linear area:database (PR #164 taxonomy)" -R raphaelfh/prumo
```

Expected: each prints `✓ Created label ...`. If any prints `already exists`, that
is fine — continue.

- [ ] **Step 2: Verify all 4 exist**

Run:

```bash
gh label list -R raphaelfh/prumo --limit 100 | grep -E "source:automation|area:extraction|area:ui-ux|area:database"
```

Expected: 4 lines, one per label.

> Note: the `area:*` labels intentionally mirror names that already exist in the
> Linear PRU team (created by #164). Native sync matches by name, so these map to
> the existing Linear labels instead of creating duplicates. `area:api` is
> deliberately NOT created (no confident scope→area mapping — see spec Non-goals).

---

## Phase 1a — Update the 5 proactive routine prompts

Each task uses the fetch → surgical replace → update → verify pattern above.

### Task 2: system-health-check — add `source:automation`

**Routine:** `trig_01FhDpFrJJtvz43qh9EY9NQB`

- [ ] **Step 1: Fetch current config**

`RemoteTrigger {action: "get", trigger_id: "trig_01FhDpFrJJtvz43qh9EY9NQB"}`

- [ ] **Step 2: In `events[0].data.message.content`, replace this exact line**

Find:

```text
Labels: prod-incident, auto-found, priority:P1
```

Replace with:

```text
Labels: prod-incident, auto-found, priority:P1, source:automation
```

(prod-incident is cross-cutting infra — no `area:*` label.)

- [ ] **Step 3: Send the full updated ccr**

`RemoteTrigger {action: "update", trigger_id: "trig_01FhDpFrJJtvz43qh9EY9NQB", body: {job_config: {ccr: <full ccr with modified content>}}}`

- [ ] **Step 4: Verify**

`RemoteTrigger {action: "get", trigger_id: "trig_01FhDpFrJJtvz43qh9EY9NQB"}`
Expected: content now contains `priority:P1, source:automation`;
`session_context.allowed_tools` still `["Bash","Read","Glob","Grep"]`;
`mcp_connections` still has Vercel + Supabase only.

### Task 3: dep-vuln-sweep — add `source:automation`

**Routine:** `trig_01QL2qyan1t6pBqJRdwneg8X`

- [ ] **Step 1: Fetch**

`RemoteTrigger {action: "get", trigger_id: "trig_01QL2qyan1t6pBqJRdwneg8X"}`

- [ ] **Step 2: Replace this exact line in the content**

Find:

```text
  Labels: dep-vuln, auto-found, priority:P1, security
```

Replace with:

```text
  Labels: dep-vuln, auto-found, priority:P1, security, source:automation
```

(A CVE is not a code area — no `area:*` label.)

- [ ] **Step 3: Update with full ccr**

`RemoteTrigger {action: "update", trigger_id: "trig_01QL2qyan1t6pBqJRdwneg8X", body: {job_config: {ccr: <full ccr>}}}`

- [ ] **Step 4: Verify**

`RemoteTrigger {action: "get", trigger_id: "trig_01QL2qyan1t6pBqJRdwneg8X"}`
Expected: content contains `security, source:automation`; `mcp_connections` empty.

### Task 4: migration-drift-detector — add `source:automation, area:database`

**Routine:** `trig_01HHfcKmJTnjn2AiqrUrSqzF`

- [ ] **Step 1: Fetch**

`RemoteTrigger {action: "get", trigger_id: "trig_01HHfcKmJTnjn2AiqrUrSqzF"}`

- [ ] **Step 2: Replace this exact line in the content**

Find:

```text
Labels: migration-drift, auto-found, priority:P0 if VERSION_MISMATCH else priority:P1
```

Replace with:

```text
Labels: migration-drift, auto-found, priority:P0 if VERSION_MISMATCH else priority:P1, source:automation, area:database
```

(Drift is always a schema/database concern → confident `area:database`.)

- [ ] **Step 3: Update with full ccr**

`RemoteTrigger {action: "update", trigger_id: "trig_01HHfcKmJTnjn2AiqrUrSqzF", body: {job_config: {ccr: <full ccr>}}}`

- [ ] **Step 4: Verify**

`RemoteTrigger {action: "get", trigger_id: "trig_01HHfcKmJTnjn2AiqrUrSqzF"}`
Expected: content contains `source:automation, area:database`; `mcp_connections`
still Supabase only.

### Task 5: bug-watch — add `source:automation` + scope→area mapping

**Routine:** `trig_01GtuwTpuQMFTcxVE6WEotvy`

- [ ] **Step 1: Fetch**

`RemoteTrigger {action: "get", trigger_id: "trig_01GtuwTpuQMFTcxVE6WEotvy"}`

- [ ] **Step 2: Replace this exact line in the content**

Find:

```text
Labels: bug, auto-found, scope:<area> where area in {services, api, models, schemas, migrations, hooks, services-frontend, components, pages}
```

Replace with:

```text
Labels: bug, auto-found, source:automation, scope:<area> where area in {services, api, models, schemas, migrations, hooks, services-frontend, components, pages}. ALSO add a best-effort area:* label (skip if not confident): scope:models|migrations -> area:database; scope:components|hooks|pages|services-frontend -> area:ui-ux; scope:services -> area:extraction ONLY if the cited file path matches extraction_*; scope:api|schemas -> skip area.
```

- [ ] **Step 3: Update with full ccr**

`RemoteTrigger {action: "update", trigger_id: "trig_01GtuwTpuQMFTcxVE6WEotvy", body: {job_config: {ccr: <full ccr>}}}`

- [ ] **Step 4: Verify**

`RemoteTrigger {action: "get", trigger_id: "trig_01GtuwTpuQMFTcxVE6WEotvy"}`
Expected: content contains `source:automation` and the `area:*` mapping note;
`session_context.allowed_tools` still includes `Skill`; `mcp_connections` empty.

### Task 6: flaky-test-tracker — add `source:automation` + scope→area mapping

**Routine:** `trig_01UA3zyf53r7BEfQgppxtzrp`

- [ ] **Step 1: Fetch**

`RemoteTrigger {action: "get", trigger_id: "trig_01UA3zyf53r7BEfQgppxtzrp"}`

- [ ] **Step 2: Replace this exact line in the content**

Find:

```text
  Labels: flaky-test, auto-found, priority:P1, scope:services (or scope:components / scope:hooks per path)
```

Replace with:

```text
  Labels: flaky-test, auto-found, priority:P1, source:automation, scope:services (or scope:components / scope:hooks per path). ALSO add best-effort area:* (skip if unsure): scope:components|hooks -> area:ui-ux; scope:services -> area:extraction only if path matches extraction_*; else skip.
```

- [ ] **Step 3: Update with full ccr**

`RemoteTrigger {action: "update", trigger_id: "trig_01UA3zyf53r7BEfQgppxtzrp", body: {job_config: {ccr: <full ccr>}}}`

- [ ] **Step 4: Verify**

`RemoteTrigger {action: "get", trigger_id: "trig_01UA3zyf53r7BEfQgppxtzrp"}`
Expected: content contains `source:automation` and area note; `mcp_connections` empty.

---

## Phase 1b — Linear-GitHub native sync (USER does this in Linear UI)

### Task 7: Connect the native sync

**Files:** none (Linear web UI). This task is performed by the user; the agent
presents the checklist and waits.

- [ ] **Step 1: Connect the integration**

In Linear: Settings → Integrations → GitHub → **Connect** → authorize the
`raphaelfh` GitHub account → select repository `raphaelfh/prumo`.

- [ ] **Step 2: Configure sync direction**

Enable:

- `GitHub Issues → Linear Issues` (1-way intake)
- `Pull requests` (link PRs to tickets)
- `Comments` (bidirectional)

Leave DISABLED: `Linear Issues → GitHub Issues` (prevents creating a GitHub issue
every time you open a Linear ticket manually).

- [ ] **Step 3: Confirm label mapping is by-name**

No manual mapping needed — Linear matches labels by name. Confirm the PRU team
already has `area:extraction`, `area:ui-ux`, `area:database` (created by #164) so
the GitHub mirror labels map onto them rather than duplicating.

- [ ] **Step 4: Smoke-test the sync**

```bash
gh issue create -R raphaelfh/prumo --title "test: linear sync smoke" \
  --label auto-found,source:automation,area:database \
  --body "Sync smoke test. Safe to close."
```

Wait ~60s, open Linear PRU Triage. Expected: a ticket "test: linear sync smoke"
with labels `auto-found`, `source:automation`, `area:database` mapped to the
existing Linear labels (no duplicate `area:database` created).

- [ ] **Step 5: Clean up the smoke test**

```bash
# Replace <N> with the issue number printed in Step 4
gh issue close <N> -R raphaelfh/prumo --reason "not planned" --comment "sync smoke test done"
```

---

## Phase 2 — Create the `linear-enrich` routine (Claude does this)

### Task 8: Create linear-enrich via RemoteTrigger

**Files:** none (claude.ai routine state).

- [ ] **Step 1: Create the routine**

`RemoteTrigger {action: "create", body: <the JSON below>}`

```json
{
  "name": "linear-enrich",
  "cron_expression": "0 14 * * *",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "env_012ibsp8thFCLZohEdPXqcU9",
      "session_context": {
        "model": "claude-sonnet-4-6",
        "sources": [{"git_repository": {"url": "https://github.com/raphaelfh/prumo"}}],
        "allowed_tools": ["Bash", "Read", "Glob", "Grep"]
      },
      "events": [{"data": {
        "uuid": "aeabfcce-69f6-4716-8f7a-e2b7cec548a7",
        "session_id": "",
        "type": "user",
        "parent_tool_use_id": null,
        "message": {"role": "user", "content": "linear-enrich: set the NATIVE Linear priority field on automation tickets (the gap GitHub label-sync cannot fill) and add a one-line AI summary. NEVER touch user-feedback tickets. Uses Linear MCP only.\n\n## Coexistence guard (PR #164)\nUser feedback reaches Linear via a separate backend GraphQL path and is tagged `source:in-app` with priority + area already set. This routine MUST skip those. Reference: backend/app/services/linear/feedback_mapping.py.\n\n## Procedure\n\n1. Use Linear MCP. Find issues in the Prumo (PRU) team created in the last 30h whose title starts with one of: `bug(`, `prod-incident:`, `dep-vuln:`, `migration-drift:`, `flaky-test:`. Limit 20.\n\n2. For each ticket, SKIP (with a counter) if ANY of:\n   - It carries label `source:in-app` -> skip (feedback owned by #164). Count skipped_feedback.\n   - It already has a comment whose body starts with `AI Summary (linear-enrich):` -> skip. Count skipped_dup.\n   - Its native priority is already set (not `No priority` / 0) -> skip (human triaged). Count skipped_humantried.\n\n3. Determine native priority (Linear int: 1 Urgent, 2 High, 3 Medium, 4 Low):\n   - If label `priority:P0` present -> 1 (Urgent).\n   - Else if label `priority:P1` present -> 2 (High).\n   - Else read the issue body `## Severity` H2: high -> 2 (High), med -> 3 (Medium), low -> 4 (Low).\n   - Else -> leave unset and skip (count skipped_unparseable).\n   This mirrors PR #164 `_PRIORITY_BY_SEVERITY` ordering.\n\n4. Generate a 1-2 sentence TL;DR from the issue `## Summary` H2 or first paragraph.\n\n5. (best-effort area backfill) If the ticket has NO `area:*` label, infer from `scope:*` and add it: scope:models|migrations -> area:database; scope:components|hooks|pages -> area:ui-ux; scope:services -> area:extraction ONLY if a cited path matches extraction_*; scope:api -> skip. If unsure, skip area.\n\n6. Update the ticket via Linear MCP:\n   - Set the NATIVE priority field to the value from step 3.\n   - (if step 5 produced one) add the area:* label.\n   - Add a comment: `AI Summary (linear-enrich): <TL;DR> | Priority: <Urgent|High|Medium|Low> from <priority:P1 label | ## Severity>`.\n\n## Hard rules\n- Max 10 tickets enriched per run.\n- NEVER set a Linear Project (Projects are for roadmap; area:* labels group by code area).\n- NEVER modify issue title or description (preserves sync-source integrity).\n- NEVER create or delete tickets.\n- NEVER touch `source:in-app` tickets or tickets without a routine title prefix.\n- READ-ONLY on the repo and on GitHub (no gh writes). Linear MCP is the only write surface.\n- If Linear MCP is unavailable, exit with `linear_enrich_done error=mcp-unavailable analyzed=0`.\n\n## Output\nLast line MUST be: `linear_enrich_done analyzed=<N> enriched=<N> skipped_feedback=<N> skipped_dup=<N> skipped_humantried=<N> skipped_unparseable=<N>`"}
      }}]
    }
  },
  "mcp_connections": [{"connector_uuid": "191572ab-93df-4f8f-b20d-aa0923b96a9f", "name": "Linear", "url": "https://mcp.linear.app/mcp"}]
}
```

Expected: HTTP 200 with a new `id` (`trig_...`). Record it as `<LINEAR_ENRICH_ID>`.

- [ ] **Step 2: Strip auto-provisioned MCP connectors down to Linear only**

The API tends to attach all connected MCPs. Re-assert Linear-only:

`RemoteTrigger {action: "update", trigger_id: "<LINEAR_ENRICH_ID>", body: {clear_mcp_connections: true}}`
then
`RemoteTrigger {action: "update", trigger_id: "<LINEAR_ENRICH_ID>", body: {mcp_connections: [{"connector_uuid": "191572ab-93df-4f8f-b20d-aa0923b96a9f", "name": "Linear", "url": "https://mcp.linear.app/mcp"}]}}`

- [ ] **Step 3: Verify config**

`RemoteTrigger {action: "get", trigger_id: "<LINEAR_ENRICH_ID>"}`
Expected:

- `cron_expression == "0 14 * * *"`
- `enabled == true`
- `session_context.allowed_tools == ["Bash","Read","Glob","Grep"]`
- `mcp_connections` has exactly ONE entry: Linear
- content contains `skipped_feedback` and the `source:in-app` skip rule

- [ ] **Step 4: Record the ID in the plan file**

Append `<LINEAR_ENRICH_ID>` to the routine table in
`/Users/raphael/.claude/plans/glittery-crafting-river.md` (the running portfolio
record). No repo commit — that file lives under `~/.claude/plans`.

---

## Phase 3 — End-to-end validation

### Task 9: Validate enrichment sets native priority

**Prereq:** Phases 0, 1b, 2 complete (labels exist, sync is on, routine exists).

- [ ] **Step 1: Create a representative automation issue on GitHub**

```bash
gh issue create -R raphaelfh/prumo --title "bug(test_enrich): native priority validation" \
  --label bug,auto-found,source:automation,scope:services,area:extraction,priority:P1 \
  --body $'## Summary\nValidation issue for linear-enrich. Safe to close.\n\n## File & Lines\nbackend/app/services/extraction_proposal_service.py:1\n\n## Severity\nhigh'
```

Record the issue number as `<TEST_ISSUE>`.

- [ ] **Step 2: Wait for sync, confirm ticket in Linear**

Wait ~60s. In Linear PRU Triage, find the mirrored ticket. Expected: labels
`auto-found`, `source:automation`, `area:extraction`, `priority:P1` present;
**native priority still "No priority"** (sync carried the label, not the field).

- [ ] **Step 3: Force-run linear-enrich**

`RemoteTrigger {action: "run", trigger_id: "<LINEAR_ENRICH_ID>"}`
Open the returned session URL on claude.ai/code and watch it run.

- [ ] **Step 4: Confirm enrichment**

In Linear, reload the test ticket. Expected:

- Native priority field is now **High (2)** (from `priority:P1`).
- A comment starting `AI Summary (linear-enrich):` with a TL;DR and
  `| Priority: High from priority:P1`.
- `area:extraction` unchanged (was already present from sync).

Session output last line expected:
`linear_enrich_done analyzed=1 enriched=1 skipped_feedback=0 skipped_dup=0 skipped_humantried=0 skipped_unparseable=0`

### Task 10: Validate the `source:in-app` skip guard (coexistence with #164)

This is the highest-risk behavior — prove `linear-enrich` never touches feedback.

- [ ] **Step 1: Create a fake feedback-style ticket directly in Linear**

In the Linear PRU team, manually create an issue:

- Title: `[Bug] test feedback skip guard`
- Label: `source:in-app` (+ `Bug` if convenient)
- Set native priority to **Urgent** manually (simulating the backend having set it).
- Body: `Simulated #164 feedback ticket. linear-enrich must NOT touch this.`

(Do not give it a `bug(`/`dep-vuln:`/etc. routine prefix — but the title here
starts with `[Bug]`, which is the #164 feedback format, not the routine `bug(`
format. The prefix check + the `source:in-app` label are two independent guards.)

- [ ] **Step 2: Force-run linear-enrich again**

`RemoteTrigger {action: "run", trigger_id: "<LINEAR_ENRICH_ID>"}`
Watch the session.

- [ ] **Step 3: Confirm the feedback ticket is untouched**

In Linear, reload `[Bug] test feedback skip guard`. Expected:

- NO `AI Summary (linear-enrich):` comment.
- Native priority still **Urgent** (unchanged).
- Session output shows `skipped_feedback>=1` OR the ticket was never analyzed
  (no routine prefix). Either way: untouched.

- [ ] **Step 4: Clean up both test artifacts**

```bash
gh issue close <TEST_ISSUE> -R raphaelfh/prumo --reason "not planned" --comment "enrich validation done"
```

Delete the `[Bug] test feedback skip guard` ticket in Linear manually.

### Task 11: Confirm quota and final portfolio state

- [ ] **Step 1: List all routines**

`RemoteTrigger {action: "list"}`
Expected: `data.length == 8` (7 original + linear-enrich). Names include
`linear-enrich`.

- [ ] **Step 2: Confirm quota headroom**

Open <https://claude.ai/code/routines>. Expected: the daily-runs banner shows the
cron baseline around **3/15** on a normal day (5 old cron averaging ~1.7 +
linear-enrich 1.0 ≈ 2.7), well under Pro's 5/day. Event-driven routines
(`bug-watch-write`, `cleanup` label trigger) do not count against the cron cap.

- [ ] **Step 3: Update the portfolio record**

In `/Users/raphael/.claude/plans/glittery-crafting-river.md`, mark the Linear
integration pendências as done and note `<LINEAR_ENRICH_ID>`. No repo commit
(file is under `~/.claude/plans`).

---

## Rollback (per phase, all reversible)

| Undo | How |
| --- | --- |
| Phase 2 routine | `RemoteTrigger {action: "update", trigger_id: "<LINEAR_ENRICH_ID>", body: {enabled: false}}` (or delete in claude.ai UI) |
| Phase 1a prompts | Re-run each Task's fetch → restore the original label line → update |
| Phase 1b sync | Linear → Settings → Integrations → GitHub → Disconnect |
| Phase 0 labels | `gh label delete "source:automation" -R raphaelfh/prumo` (repeat per label) |

Disabling `linear-enrich` and disconnecting sync returns the system to the exact
GitHub-only state that exists today. The #164 feedback flow is unaffected by any
rollback (it never depended on this work).

---

## Notes for the executor

- **No repo commits** in this plan. Everything is remote state (routines API,
  GitHub labels, Linear UI). The only repo artifacts (spec, this plan) are
  already committed on `dev`.
- **Phase ordering:** 0 → (1a ∥ 1b) → 2 → 3. Phase 0 must precede the first cron
  fire of any updated routine and the Phase 1b smoke test (labels must exist).
  Phase 2 can be created anytime but only has tickets to enrich after 1b.
- **The 2 PR-opening routines** (`cleanup`, `bug-watch-write`) are intentionally
  untouched — they open PRs, not issues, so no source/area labels apply.
- If `RemoteTrigger get` shows a routine's `mcp_connections` re-bloated by the API
  on any update, re-assert with `clear_mcp_connections: true` then set the intended
  connectors (the pattern from Task 8 Step 2).

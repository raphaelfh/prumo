---
status: draft
created: 2026-05-26
owner: '@raphaelfh'
---

# Design — Extraction Value Coherence

> **Status:** Draft · Created: 2026-05-26 · Owner: @raphaelfh
> Closes the class of bug where extraction form renders blank while the
> badge says "completed" — re-establishes coherence between
> `proposal_records`, `reviewer_decisions`, and `published_states`.

## 0. Implementation status (2026-05-27)

What actually shipped is a deliberate subset of the design below. Recorded
here so the document does not overstate the code:

- **H1 — shipped, narrowed.** `loadValuesForUser` merges **two** layers:
  the user's `reviewer_decisions` over their own `human` `proposal_records`
  (decision wins; `reject` clears; else the latest human proposal fills in).
  The `published_states` and `ai`-proposal precedence layers in §4.1 / §6.1
  are **deferred** — not needed for the reported bug (REVIEW-stage human
  value rendering blank) and a no-regression change vs the old
  reviewer-states-only read.
- **H1 — `useExtractedValues` unchanged.** §6.2's "collapse the stage
  branches onto one read" was **not done**. The hook keeps its existing
  `proposal` / REVIEW+ / pending branching and simply consumes the richer
  `loadValuesForUser` return in the REVIEW+ branch.
- **H2 — shipped as designed** (`run_lifecycle_service`, §5.1).
- **H3 — shipped as designed** (`template_clone_service`, §5.2).
- **H4 — shipped as designed** (`ArticleExtractionTable` +
  `findFormRunsByArticle`, §6.3).

Deferred follow-up: extend `loadValuesForUser` to the full 4-layer
precedence (`published > decision > human > ai`) and fold the hook's
branches onto it, with the 4-layer precedence tests in §7.

## 1. Context

A user reported: the article extraction list shows article `5573e7f3` as
"completed", but opening the form renders the response variable as blank.

Direct DB inspection found the value `"Case series"` (field
`data_source`, instance `source_of_data`) sitting in
`extraction_proposal_records` with `source='human'`, while the run is at
`stage='review'` and `extraction_reviewer_decisions` is empty.

The same pattern holds for **every** CHARMS run in that project: stage
`review`, proposals exist, decisions do not. The condition is systemic,
not a one-off.

Root-cause investigation surfaced four interlocking defects:

1. **Read path stage-conditional, write path stage-agnostic.**
   `useAutoSaveProposals` (frontend) always posts to
   `/api/v1/runs/{id}/proposals` — proposal_records, regardless of stage.
   `useExtractedValues` reads `runDetail.proposals` only in `proposal`
   stage; in `review`/`consensus`/`finalized` it reads from
   `extraction_reviewer_states` exclusively. The user's autosaved input
   becomes invisible the moment the run advances.

2. **Stage transition doesn't materialize decisions.**
   `RunLifecycleService.advance_stage(PROPOSAL → REVIEW)` (triggered by
   `model_extraction_service` and `section_extraction_service` after AI
   runs) flips the stage but leaves existing human proposals orphaned.

3. **Clone heal only triggers on zero-state.**
   `TemplateCloneService` heals project templates whose
   `extraction_entity_types` count is zero — but partial clones (some
   entity_types but not all of the snapshot) go undetected. The
   reported article's CHARMS clone has 14 entity_types in the version
   snapshot but only 1 in the live tables.

4. **Article badge cross-runs.**
   `ArticleExtractionTable.tsx:270` filters `reviewer_states` and
   `proposal_records` only by `instance_id`; since instances persist
   across runs, the badge aggregates values from runs the form will
   never open.

The fundamental misalignment: the three value layers (proposal_records,
reviewer_decisions, published_states) have unclear contracts. The
architecture documents the AI-first flow (AI proposes → user reviews →
manager publishes), but does not define what happens when a human types
during proposal stage and the run subsequently advances.

## 2. Goals

- Define explicit contracts for each value layer.
- Make the data invariants enforceable at the service level.
- Make the form render coherent values regardless of which layer holds
  truth at the moment.
- Eliminate the conditions for the entire class of bug, not just patch
  the specific symptom.
- Best-possible code: no legacy/back-compat shims, no backfill
  migrations. The project is in alpha; pre-existing partial-state data
  is wipeable.

## 3. Non-goals

- Backfill migrations or heal scripts for existing orphan data
  (proposals without decisions, partial CHARMS clones). Alpha — wipe
  the affected project and re-import.
- Multi-reviewer flow UX redesign. This spec keeps the existing
  consensus model untouched; it only fixes the data-coherence gap
  between layers.
- Adding an explicit "Publish extraction" UI. Extraction currently
  auto-advances via AI services; a separate manual-finalize button is
  a future iteration.

## 4. Layered value model — explicit contracts

| Layer | Append-only? | Authoritativeness | Filled by |
| --- | --- | --- | --- |
| `extraction_proposal_records` | Yes | Raw input audit (per source) | `useAutoSaveProposals` autosave (`source='human'`), AI extraction (`source='ai'`) |
| `extraction_reviewer_decisions` | Yes | Per-reviewer formal commitment | Stage transition auto-materialize (for human proposals) OR explicit reviewer action (`/v1/runs/{id}/decisions`) |
| `extraction_published_states` | Versioned | Canonical post-consensus | Consensus resolution (`extraction_consensus_service`) |

### 4.1 Invariants (post-change)

I-1. **In stage ≥ `review`, every `(run_id, instance_id, field_id)` that
has a `proposal_record` with `source='human'` AND non-null
`source_user_id` has a corresponding `reviewer_decision`** owned by
`source_user_id`, materialized at the moment the run advanced into
review. AI proposals (`source='ai'`) are exempt — they require explicit
reviewer review.

I-2. **Form read precedence** — for each `(instance_id, field_id)`,
applied uniformly across all non-`pending` stages:
1. `published_states.value` (if a row exists for this run/instance/field)
2. Current user's `reviewer_decisions.value` (latest, via `reviewer_states`;
   `decision='reject'` clears)
3. Current user's latest `proposal_records.proposed_value` where
   `source='human'`
4. Latest `proposal_records.proposed_value` where `source='ai'` (AI
   suggestion shows by default until the user types over it or rejects;
   in `review`+ stages it stays visible *only until* the reviewer
   explicitly accepts — at which point it materializes as a decision
   and is now read via #2)
5. Otherwise: empty.

Why human ranks above AI: today PROPOSAL-stage reads "newest proposal
wins regardless of source", so a late AI run silently overwrites typed
input. Inverting to "human always wins over AI" is a deliberate UX
correction — user input is a commitment, AI is a suggestion.

I-3. **`TemplateCloneService` keeps live tables consistent with the
snapshot** — the count of `extraction_entity_types` and
`extraction_fields` rows for a `project_template_id` equals the count
inside `extraction_template_versions.schema->'entity_types'` /
`->'fields'` for the active version.

## 5. Backend changes

### 5.1 `RunLifecycleService.advance_stage` — materialize on PROPOSAL→REVIEW

When the target_stage is `REVIEW` and current stage is `PROPOSAL`, after
all existing precondition checks pass and before commit:

```python
# Pseudocode in app/services/run_lifecycle_service.py
async def _materialize_human_decisions(self, run_id: UUID) -> None:
    """Auto-create reviewer_decisions for human proposals on stage
    transition. Idempotent: skips pairs that already have a decision.
    """
    rows = await self.db.execute(
        select(ProposalRecord)
        .where(
            ProposalRecord.run_id == run_id,
            ProposalRecord.source == 'human',
            ProposalRecord.source_user_id.isnot(None),
        )
        .order_by(ProposalRecord.created_at.desc())
    )
    # Pick latest proposal per (instance, field).
    latest_per_pair: dict[tuple[UUID, UUID], ProposalRecord] = {}
    for p in rows.scalars():
        key = (p.instance_id, p.field_id)
        if key not in latest_per_pair:
            latest_per_pair[key] = p

    for (instance_id, field_id), proposal in latest_per_pair.items():
        # Skip if any reviewer_decision already exists for this triple.
        existing = await self.db.execute(
            select(ReviewerDecision.id)
            .where(
                ReviewerDecision.run_id == run_id,
                ReviewerDecision.instance_id == instance_id,
                ReviewerDecision.field_id == field_id,
                ReviewerDecision.reviewer_id == proposal.source_user_id,
            )
            .limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            continue

        decision = ReviewerDecision(
            run_id=run_id,
            reviewer_id=proposal.source_user_id,
            instance_id=instance_id,
            field_id=field_id,
            decision='accept_proposal',
            proposal_record_id=proposal.id,
            value=proposal.proposed_value,
        )
        self.db.add(decision)
        await self.db.flush()
        await self._upsert_reviewer_state(
            run_id=run_id,
            reviewer_id=proposal.source_user_id,
            instance_id=instance_id,
            field_id=field_id,
            decision_id=decision.id,
        )
```

`advance_stage` calls `_materialize_human_decisions` after stage flip,
inside the same transaction. The advisory lock at
`hitl_session_service:_take_advisory_xact_lock` already serializes
concurrent advances for `(article, template)`.

This holds invariant I-1 at the service boundary. AI proposals are
untouched — a human reviewer must explicitly accept/edit/reject them.

### 5.2 `TemplateCloneService` — drift-detection heal

In `TemplateCloneService.clone`, after looking up the project template,
expand the heal trigger:

```python
# Pseudocode in app/services/template_clone_service.py
needs_heal = (
    live_entity_type_count == 0
    or live_entity_type_count != snapshot_entity_type_count
    or live_field_count != snapshot_field_count
)
if needs_heal:
    await self._rebuild_structure_from_global(project_template)
```

`snapshot_entity_type_count` and `snapshot_field_count` come from
`jsonb_array_length` on the active `extraction_template_versions.schema`
row. The rebuild path already exists (the current zero-state heal).

This holds invariant I-3.

### 5.3 No new tables, no new migrations

Schema is unchanged. All invariants are enforced at the service level
(in-transaction). A future iteration may add a deferred CHECK constraint
or trigger for I-1, but it's out of scope here — the service guard is
sufficient and avoids per-decision write friction.

## 6. Frontend changes

### 6.1 `ExtractionValueService.loadValuesForUser` — precedence merge

Replace the current single-table read with a precedence-aware merge.
Four parallel queries (small N — one run scope):

```typescript
// frontend/services/extractionValueService.ts
async loadValuesForUser(
  runId: string,
  reviewerId: string,
): Promise<DecisionValueRow[]> {
  const [published, decisions, humanProposals, aiProposals] = await Promise.all([
    supabase.from('extraction_published_states')
      .select('instance_id, field_id, value, version')
      .eq('run_id', runId),
    supabase.from('extraction_reviewer_states')
      .select(`run_id, reviewer_id, instance_id, field_id, current_decision_id,
        reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match (
          decision, value, created_at
        )`)
      .eq('run_id', runId)
      .eq('reviewer_id', reviewerId),
    supabase.from('extraction_proposal_records')
      .select('instance_id, field_id, proposed_value, created_at')
      .eq('run_id', runId)
      .eq('source', 'human')
      .eq('source_user_id', reviewerId)
      .order('created_at', { ascending: false }),
    supabase.from('extraction_proposal_records')
      .select('instance_id, field_id, proposed_value, created_at')
      .eq('run_id', runId)
      .eq('source', 'ai')
      .order('created_at', { ascending: false }),
  ]);

  const merged = new Map<string, DecisionValueRow>();
  const key = (i: string, f: string) => `${i}_${f}`;

  // Iterate from lowest to highest precedence — each loop overwrites.
  // Within a single source (AI / human), latest-first sort + "set only
  // if absent" picks the latest per (instance, field).
  for (const p of aiProposals.data ?? []) {
    const k = key(p.instance_id, p.field_id);
    if (!merged.has(k)) merged.set(k, fromProposal(p, 'ai'));
  }
  for (const p of humanProposals.data ?? []) {
    const k = key(p.instance_id, p.field_id);
    // Overwrite AI; keep "latest human" by checking source.
    const current = merged.get(k);
    if (!current || current.source === 'ai') {
      merged.set(k, fromProposal(p, 'human', reviewerId));
    }
  }
  for (const d of decisions.data ?? []) {
    const k = key(d.instance_id, d.field_id);
    if (d.reviewer_decision?.decision === 'reject') {
      merged.delete(k);
    } else if (d.reviewer_decision) {
      merged.set(k, fromDecision(d));
    }
  }
  for (const ps of published.data ?? []) {
    merged.set(key(ps.instance_id, ps.field_id), fromPublished(ps, reviewerId));
  }
  return [...merged.values()];
}
```

This holds invariant I-2. Reject decisions clear the value at the
decision layer; published_state still overrides on top (post-consensus
reject would have produced no published_state, so this is consistent).

### 6.2 `useExtractedValues` — unify the read

The hook currently switches between two branches based on stage (one
for `proposal`, one for `review`/`consensus`/`finalized`). With the
precedence merge in §6.1 spanning all four layers, the branches
collapse — `loadValuesForUser` handles every non-`pending` stage
identically:

```typescript
// frontend/hooks/extraction/useExtractedValues.ts
if (!runId || stage === 'pending') return { values: {}, ... };
const rows = await ExtractionValueService.loadValuesForUser(runId, user.id);
```

The `proposals` prop drilled into the hook from `runDetail.proposals`
becomes redundant — drop it. Hook signature simplifies.

UI tagging (showing a "from AI" badge per field) consumes a new
`source` discriminator added to `DecisionValueRow` rather than living
in the hook's branch logic.

### 6.3 `ArticleExtractionTable` — run-scoped queries

In `ArticleExtractionTable.tsx:270`, scope the badge queries by
`run_id` per article. Use `ExtractionValueService.findActiveRun`
(or the existing session result if cached) to resolve which run the
form would open, then filter:

```typescript
// frontend/components/extraction/ArticleExtractionTable.tsx
.from('extraction_reviewer_states')
.select(...)
.in('run_id', activeRunIdsForBatch)  // <-- added
.in('instance_id', instanceIds)
.eq('reviewer_id', currentUserId);
```

`activeRunIdsForBatch` resolves the same way the form does:
`findActiveRun` ∪ `findLatestFinalizedRun` per article. Batch-fetch.

## 7. Tests

| Layer | Test | Asserts |
| --- | --- | --- |
| Backend pytest | `test_advance_proposal_to_review_materializes_human_decisions` | After advance, each human proposal has a `reviewer_decision='accept_proposal'` owned by source_user_id. AI proposals have no auto-decision. |
| Backend pytest | `test_advance_proposal_to_review_idempotent_on_existing_decisions` | Re-advance (after a roll-back+retry) does not duplicate decisions. |
| Backend pytest | `test_clone_heal_detects_snapshot_live_drift` | A clone with N entity_types in snapshot but fewer in live tables triggers heal; post-heal counts match. |
| Backend pytest | `test_clone_heal_no_op_when_aligned` | Re-cloning an aligned template does not rewrite. |
| Frontend vitest | `extractionValueService.loadValuesForUser.precedence.spec` | All 4 layers, every combination: published > decision (non-reject) > human_proposal > ai_proposal; reject decision clears unless published overrides. |
| Frontend vitest | `extractionValueService.loadValuesForUser.human-beats-ai.spec` | Human proposal created before AI proposal — human still wins after AI runs (regression guard for the inverted precedence). |
| Frontend vitest | `useExtractedValues.review-with-only-proposals.spec` | Given run in `review` with human proposal but no decision, hook returns the proposal value (defensive read; auto-materialize will populate decisions next advance, but hook stays correct in the interim). |
| Frontend vitest | `useExtractedValues.unified-stages.spec` | Same data shape across `proposal`/`review`/`finalized` stages — hook returns the correct precedence pick in each. |
| Frontend vitest | `ArticleExtractionTable.cross-runs.spec` | Two runs (one finalized, one new) — badge counts only the run-scoped values. |
| E2E Playwright | `extraction-persists-across-refresh.spec.ts` | Type a value, refresh the page, value is rendered. |

`make test-backend` + `npm test` must be green. Targeted Playwright on
the extraction surface — full E2E suite is not gated on this change.

## 8. Migration policy

**None.** Alpha environment. The reported project (`bc055915`) has
inconsistent data: partial CHARMS clone, orphan proposals across
multiple runs. After this design lands:

1. Delete the partial CHARMS project_extraction_template row for project
   `bc055915` (CASCADE clears the broken entity_types/fields/instances/
   runs).
2. Re-import CHARMS via the existing `POST /api/v1/projects/{id}/templates/clone`
   endpoint — the heal path now detects and rebuilds correctly.

No code in the spec deals with legacy data. The change is forward-only.

## 9. Future considerations (out of scope here)

- **Auto-advance review → consensus → finalized for single-reviewer
  mode.** Today the run sits in `review` after AI extraction; a manual
  publish or an auto-finalize on save would complete the lifecycle.
  Currently the form is the de-facto truth via the precedence read; the
  published_state layer is unused for single-reviewer until consensus
  runs. This is a UX improvement, not a correctness gap, and is
  deferred.

- **Deferred CHECK / trigger for invariant I-1.** A
  `NOT VALID`+`VALIDATE` trigger on `extraction_runs` stage updates
  could enforce I-1 at the schema level. Out of scope; service-level
  enforcement is sufficient for V1.

- **Badge progress definition.** The current fallback ("instance has any
  extracted value") is a proxy for completion. A more accurate "all
  required fields filled" would replace `every(i.status === 'completed')`
  (a field never set by code) with `required_field_count == filled_count`.
  Deferred.

## 10. Reference index

- Architecture canon: `docs/reference/extraction-hitl-architecture.md`
- Source of the symptom: `frontend/services/extractionValueService.ts:161`
- Source of the auto-advance: `backend/app/services/section_extraction_service.py:225`,
  `backend/app/services/model_extraction_service.py:188`
- Source of the badge: `frontend/components/extraction/ArticleExtractionTable.tsx:270`
- Clone service: `backend/app/services/template_clone_service.py`
- Lifecycle service: `backend/app/services/run_lifecycle_service.py:145`

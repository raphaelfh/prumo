# Write path: typed edits, un-accept and undo keep the AI link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the day this ships, every reviewer `edit` decision keeps its AI lineage.
- A typed edit over an accepted AI value carries that proposal's id.
- Un-accept and undo restore the predecessor's link along with its value.
- Redo is unchanged.

**Architecture:** Frontend only, with no API or schema change.
- The writer (`useRunValues.writeValue`) decides the link it sends from the caller's head decision and the run view's `source=ai` proposals.
- The writer resolves with the link the dirty fingerprint will derive for the value it wrote: `acceptedProposal([result.data], params.draft)`. That is the same value-equality rule as `linkByKey` (`useRunValues.ts:169-174`). The autosave queue acknowledges `[draft, that link]`, so the coordinate is never re-dirtied. This holds when the server canonicalizes the value (number `'5'` → `5`, `value_contract.py:145-152`).
- Un-accept takes the link from `history.at(-2)`.
- Undo takes it from a new `LocalDecision.predecessorLink`, filled in `record()`.

**Tech Stack:** React 19, TanStack Query, Vitest + MSW, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md` §2 rows 2-4, §11 row 2.

**Depends on:** nothing. It ships first, ahead of PR1: "PR2 ships early: every day without it adds unlinked data."

**Consumed by:** PR5 sets `LINEAGE_EXACT_SINCE` (`data_sheet.py`) to the UTC date of the first prod deploy that contains this PR (R21). Task 6 records that date.

**Branch:** `feat/export-write-path` off `dev`.

## Global Constraints

- **Rule (spec §11 row 2):** `writeValue` sends `history.at(-1)?.proposal_record_id` only when:
  - the draft is non-null, and
  - that proposal is `source=ai`, looked up in the run's proposals (`runDetail.proposals`, `ProposalRecordResponse.source`).
- **Un-accept and undo** carry the predecessor's link. **Redo** is unchanged: it already re-sends `entry.proposalRecordId` (`useRunValues.ts:349`).
- Fix the stale comment at `useAutoSaveProposals.ts:72-75`, which says "Later manual edits keep the link".
- `LINEAGE_EXACT_SINCE` (PR5, `data_sheet.py`) is **this PR's prod promotion date** (R21), not its `dev` merge date: prod data stays unlinked until the `dev → main` promotion deploys. Task 6 records it in this PR's body.
- No dead code: `WriteProposalParams.proposalRecordId` loses its only reader, so it is deleted here (`npx knip` stays at zero).
- English only. Conventional commits. The PR targets `dev`.

## Review Focus

1. **Double write or replay after a linked typed write.**
   - String value: `linkByKey` turns from `undefined` to `p1`, but the old ack was `fingerprint(value, undefined)` (`useAutoSaveProposals.ts:298-302`).
   - Server-canonicalized value (`'5'` → `5`): `linkByKey` stays `undefined` because `decisionMatchesVersion` fails (`valueEquality.ts:52`). Acknowledging the *sent* link would therefore re-dirty forever. Each replay would also push one more undo entry (`record()`, `useRunValues.ts:196`).
   - Covered by Task 1's queue test and Task 2's string and canonicalized "exactly two writes" tests.
2. **Hydration of a linked typed edit** (head `{value:'X', link:'p1'}`, current `'X'`) must post nothing on mount. Task 2 extends the mount test.
3. **A head link that is not an AI proposal of this run** must not propagate into a typed edit. This covers a `system` source (reachable via the API, F18) and an id absent from `runDetail.proposals`. Task 2 `it.each`.
4. **Undo after redo.** Redo's `record()` must forward `predecessorLink`, or the next undo drops the link. Task 4.
5. **Re-toggling after an un-accept restore (accepted, D8).** After accept p1, accept p2 and un-accept, the head is `{AI, p1}`, so p1 shows as accepted. Clicking p1 again reverses to `history.at(-2)`, which is the p2 acceptance with p2's link (`useRunValues.ts:291-292`, `proposalDecisionState.ts:67-68`). The toggle ping-pongs between p1 and p2. D8 accepts this; Task 3 pins it. Do not add a special case.
6. **Accepted gaps (D8), not defects.**
   - A no-information marker typed over accepted AI is a recorded answer and keeps the link (Task 2).
   - A server-canonicalized typed edit (`'5'` → `5`) carries p1 on the server row, but the UI does not show the coordinate as AI-linked, because `acceptedProposal` is value-equality gated (`proposalDecisionState.ts:72-75`). Lineage in the export is exact. Task 2 pins only the single write.

## Tasks

### Task 1: Autosave acknowledges the link the writer resolves with

**Files:**
- Modify:
  - `frontend/hooks/runs/useAutoSaveProposals.ts:67-88`: rewrite the `linkByKey` doc (the stale comment) and the `writeValue` type.
  - `frontend/hooks/runs/useAutoSaveProposals.ts:282-303`: drop `proposalRecordId` from the `write(...)` call, pass `draft: valueData`, ack with the resolved link, and reword the comment at `:298-299`.
  - `frontend/services/extractionRunService.ts:145-151`: delete `proposalRecordId` and its doc, and add `draft`.
  - `frontend/hooks/runs/useRunValues.ts:233-248`: `writeValue` resolves with the derived link (the link sent is still `null`).
- Test: `frontend/test/hooks/useAutoSaveProposals.test.tsx`
  - `postEdit` at `:43-55`.
  - The D0 block at `:861-972`.

**Interfaces:**
- Produces:
  - `writeValue: (params: WriteProposalParams) => Promise<string | null>`, doc: "Writes one dirty coordinate and resolves with the AI link `linkByKey` will derive for `params.draft` once the decision is recorded; rejects when the write failed."
  - `WriteProposalParams` is now `{runId; instanceId; fieldId; normalizedValue; absentReason?; draft: unknown}`. `draft` doc: "The form value the queue fingerprints (pre-normalization)."
  - In `useRunValues.writeValue`, the resolved link is `acceptedProposal([result.data], params.draft)` (`proposalDecisionState.ts:72`).
- Consumes: `fingerprintCoord(value, link)` (`frontend/lib/extraction/autosaveDirty.ts:31`), unchanged.

- [ ] **Step 1: Write the failing test.**
  - `postEdit` drops the `proposal_record_id` spread and resolves `null`.
  - Delete `'attaches proposal_record_id to the edit decision for linked coords'` (`:862`) and `'omits proposal_record_id for unlinked coords'` (`:894`). They pin the pass-through this task removes.
  - Rename the describe to `'useAutoSaveProposals — AI link fingerprint'`.
  - `'a link-only adoption on an unchanged value still writes the linked decision'` (`:915`): rename it to `'a link-only change on an unchanged value re-dirties the coord'`. Its final assertion becomes `body: expect.objectContaining({ value: { value: 'same' } })` with `toHaveBeenCalledTimes(1)`.
  - Add:

```tsx
it('acknowledges the link the writer resolved with, so a link appearing after the write is not re-written', async () => {
  const writes: WriteProposalParams[] = [];
  const writer = async (p: WriteProposalParams) => { writes.push(p); return 'prop-9'; };
  const props: QueueProps = { runId: 'run-1', stage: 'extract', values: { 'inst-1_field-1': 'typed' } };
  const { result, rerender } = renderHook((p: QueueProps) => useAutoSaveProposals({ ...p, writeValue: writer }), { initialProps: props });
  await act(async () => { await result.current.saveNow(); });
  rerender({ ...props, linkByKey: { 'inst-1_field-1': 'prop-9' } });
  await act(async () => { await result.current.saveNow(); });
  expect(writes).toHaveLength(1);
  expect(writes[0].draft).toBe('typed');
  expect(result.current.hasUnsavedChanges).toBe(false);
});
```

- [ ] **Step 2: Run it.**
  - Command: `npx vitest run frontend/test/hooks/useAutoSaveProposals.test.tsx -t "acknowledges the link"`
  - Expected: FAIL, `expected length 1, got 2`. The ack is `fingerprintCoord('typed', undefined)` and the current fingerprint is `('typed', 'prop-9')`.
- [ ] **Step 3: Implement.**
  - In the batch: `return write({runId, instanceId, fieldId, normalizedValue: normalized, absentReason, draft: valueData}).then(link => { runAcks[key] = fingerprintCoord(valueData, link); })`.
  - Rewrite the `linkByKey` doc: "`coordKey` → the caller's head link while the head still matches the value (`useRunValues`). It is read only by the dirty fingerprint. The writer decides the link it sends and resolves with the link this map will hold for the written draft, and the queue acknowledges `[draft, that link]`."
  - `useRunValues.writeValue` ends `return acceptedProposal([result.data], params.draft);`.
  - Remove `proposalRecordId` from `WriteProposalParams`.
- [ ] **Step 4: Run it.**
  - Commands: `npx vitest run frontend/test/hooks/useAutoSaveProposals.test.tsx frontend/test/hooks/useRunValues.test.tsx` and `npm run typecheck`.
  - Expected: PASS.
- [ ] **Step 5: Commit.** `fix(runs): acknowledge the AI link the fingerprint derives, not the pre-write link`

### Task 2: A typed edit keeps the head's AI link

**Files:**
- Modify `frontend/hooks/runs/useRunValues.ts`:
  - `:18-26`: module doc, adding the typed-edit rule.
  - `:96-147`: an `aiProposalIds` memo, plus `aiIdsRef` synced in the existing effect.
  - `:233-248`: `writeValue`.
- Test: `frontend/test/hooks/useRunValues.test.tsx`
  - New fixture after `:39`.
  - Module `let canon` (reset in `beforeEach` at `:40`); the POST handler (`:44-58`) builds `decision` from `{...body, value: canon(body.value!)}`.
  - `setup` at `:80-91` gains a `proposals` option.
  - New tests in `'one accept path for both kinds'` (`:258`).
  - Extend the mount test at `:199`.

**Interfaces:**
- Consumes: `RunViewResponse.proposals: components['schemas']['ProposalRecordResponse'][]` (`source: string`); `latestHistory(coordinate, run)` (`:182`).
- Produces: `const aiProposalIds: ReadonlySet<string> = useMemo(() => new Set((runDetail?.proposals ?? []).filter(p => p.source === 'ai').map(p => p.id)), [runDetail?.proposals])`.
- The link is computed like this:

```ts
const head = history.at(-1);
const cleared = params.normalizedValue === null && !params.absentReason;
const link = !cleared && head?.proposal_record_id && aiIdsRef.current.has(head.proposal_record_id) ? head.proposal_record_id : null;
```

It is sent as `proposal_record_id: link`, replacing the literal `null` at `:239`.

- [ ] **Step 1: Write the tests.** The red set is `'a typed edit over an accepted AI value …'` (both) and `'a no-information marker over …'`. The rest are regression guards that already pass today, because `:239` hard-codes `null`.
  - Add the fixture `const aiRow = (id: string, value: unknown = 'AI', source = 'ai') => ({id, run_id: 'run', instance_id: 'i', field_id: 'a', source, source_user_id: null, proposed_value: {value}, confidence_score: null, rationale: null, created_at: '2026-09-15T00:00:00Z'});`.
  - Add `let canon: (v: Record<string, unknown>) => Record<string, unknown>;`, set to `v => v` in `beforeEach`.
  - Change the setup signature to `setup(hydrated = {}, {kind = 'extraction' as Kind, proposals = [] as unknown[]} = {})`, passing `proposals` to `makeRunView`.

```tsx
it('a typed edit over an accepted AI value sends its id in exactly one write', async () => {
  const view = setup({}, {proposals: [aiRow('p1')]});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  act(() => view.result.current.edit('a', 'X'));
  await act(async () => {await view.result.current.saveNow();});
  await act(async () => {await view.result.current.saveNow();});
  expect(requests.map(r => [r.value, r.proposal_record_id])).toEqual([[{value: 'AI'}, 'p1'], [{value: 'X'}, 'p1']]);
  expect(requests[1].expected_current_decision_id).toBe('1');
  expect(view.result.current.isAccepted(proposal)).toBe(false);
});
it('a typed edit over an accepted AI value the server canonicalizes is written once and recorded once', async () => {
  canon = v => (v.value === '5' ? {...v, value: 5} : v);
  const view = setup({}, {proposals: [aiRow('p1')]});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  act(() => view.result.current.edit('a', '5'));
  await act(async () => {await view.result.current.saveNow();});
  await act(async () => {await view.result.current.saveNow();});
  expect(requests.map(r => [r.value, r.proposal_record_id])).toEqual([[{value: 'AI'}, 'p1'], [{value: '5'}, 'p1']]);
  expect(view.result.current.undoTarget).toMatchObject({id: '2', value: {value: 5}, proposalRecordId: 'p1'});
});
it('guard: accept, clear, then type sends no link', async () => {
  const view = setup({}, {proposals: [aiRow('p1')]});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  act(() => view.result.current.edit('a', null));
  await act(async () => {await view.result.current.saveNow();});
  act(() => view.result.current.edit('a', 'Y'));
  await act(async () => {await view.result.current.saveNow();});
  expect(requests.map(r => r.proposal_record_id)).toEqual(['p1', null, null]);
});
it.each([['a system proposal', [aiRow('s1', 'S', 'system')]], ['a proposal outside this run view', []]])('guard: a head linked to %s carries no link into a typed edit', async (_l, proposals) => {
  history = [{...row('1', 'a', {value: 'S'}), proposal_record_id: 's1'}];
  const view = setup({a: 'S'}, {proposals});
  act(() => view.result.current.edit('a', 'T'));
  await act(async () => {await view.result.current.saveNow();});
  expect(requests).toEqual([expect.objectContaining({value: {value: 'T'}, proposal_record_id: null})]);
});
it('a no-information marker over an accepted AI value keeps the link (D8)', async () => {
  const view = setup({}, {proposals: [aiRow('p1')]});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  act(() => view.result.current.edit('a', {value: null, absent_reason: 'no_information'}));
  await act(async () => {await view.result.current.saveNow();});
  expect(requests.at(-1)).toMatchObject({value: {value: null, absent_reason: 'no_information'}, proposal_record_id: 'p1'});
});
```

  - Extend the mount test (`:199`) with a third coordinate as a guard: `{...row('3', 'c', {value: 'X'}), proposal_record_id: 'p1'}`, `current('c', 'X')` and `proposals: [aiRow('p1')]`. It still expects `requests` to have length 0.
- [ ] **Step 2: Run them.**
  - Command: `npx vitest run frontend/test/hooks/useRunValues.test.tsx -t "typed edit over an accepted|no-information marker over|guard:"`
  - Expected: the red set FAILS because the typed write carries `proposal_record_id: null` (`useRunValues.ts:239`). The `guard:` tests PASS.
- [ ] **Step 3: Implement** the link rule in Interfaces.
  - Add `aiIdsRef` next to `decisionsRef` (`:133`).
  - Write the ref in the effect at `:137-147` and add it to that effect's deps.
- [ ] **Step 4: Run it.**
  - Command: `npx vitest run frontend/test/hooks/useRunValues.test.tsx`
  - Expected: PASS, including the unchanged `:390` test (no proposals, so `:401` still asserts `null`).
- [ ] **Step 5: Commit.** `fix(runs): carry the head AI link into a typed edit (spec 2026-10-30 PR2)`

### Task 3: Un-accept restores the predecessor's link

**Files:**
- Modify:
  - `frontend/lib/extraction/proposalDecisionState.ts:67-69` (`reversalPayload`).
  - `frontend/hooks/runs/useRunValues.ts:293-298`.
- Test:
  - `frontend/lib/extraction/proposalDecisionState.test.ts:46-52`.
  - `frontend/test/hooks/useRunValues.test.tsx`: `:346-361`, plus a new test after it.

**Interfaces:**
- Produces: `export function reversalPayload(history: readonly ReviewerDecisionResponse[]): {value: Record<string, unknown>; proposal_record_id: string | null}`. It returns `history.at(-2)`'s value and link, and `{value: {value: null}, proposal_record_id: null}` when there is no predecessor.
- `acceptProposal` sends `...(reverse ? reversalPayload(history) : {value: toConsensusValueEnvelope(proposal.value), proposal_record_id: proposal.id})`.

- [ ] **Step 1: Write the failing tests.**
  - `proposalDecisionState.test.ts`. The `row` default link is its id.

```ts
expect(reversalPayload([row('a', value), row('b', {value: 'B'})])).toEqual({value, proposal_record_id: 'a'});
expect(reversalPayload([row('a', {value: 'A'})])).toEqual({value: {value: null}, proposal_record_id: null});
```

  - In `useRunValues.test.tsx`, rename `:346` to `'un-accepting B restores A with its link, then undoes multiple local actions at one coordinate'`.
  - It uses `setup({}, {proposals: [aiRow('p1'), aiRow('p2', ['B', 'C'])]})`.
  - Replace `:351-352` with:

```tsx
expect(requests.at(-1)).toMatchObject({value: {value: 'AI'}, proposal_record_id: 'p1', expected_current_decision_id: '2'});
expect(view.result.current.acceptedProposalIdFor('i', 'a')).toBe('p1');
expect(view.result.current.isAccepted(proposal)).toBe(true);
```

  - Add a test that pins the D8 ping-pong (Review Focus 5):

```tsx
it('un-accepting A after it was restored reverses to the B acceptance (D8 ping-pong)', async () => {
  const view = setup({}, {proposals: [aiRow('p1'), aiRow('p2', ['B', 'C'])]});
  const second = {...proposal, id: 'p2', value: ['B', 'C']};
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  await act(async () => {await view.result.current.acceptProposal(second);});
  await act(async () => {await view.result.current.acceptProposal(second);});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  expect(requests.at(-1)).toMatchObject({value: {value: ['B', 'C']}, proposal_record_id: 'p2', expected_current_decision_id: '3'});
  expect(view.result.current.isAccepted(second)).toBe(true);
});
```

- [ ] **Step 2: Run them.**
  - Command: `npx vitest run frontend/lib/extraction/proposalDecisionState.test.ts frontend/test/hooks/useRunValues.test.tsx -t "reversal|restores the full|first acceptance|un-accepting"`
  - Expected: FAIL. `reversalPayload` returns a bare envelope, and the un-accept sends `proposal_record_id: null` (`:295`).
- [ ] **Step 3: Implement** the signature in Interfaces. Leave the reverse detection at `:291-292` unchanged.
- [ ] **Step 4: Run it.**
  - Command: `npx vitest run frontend/lib/extraction/proposalDecisionState.test.ts frontend/test/hooks/useRunValues.test.tsx`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `fix(runs): un-accept restores the predecessor's AI link`

### Task 4: Undo restores the predecessor's link (`LocalDecision.predecessorLink`)

**Files:**
- Modify `frontend/hooks/runs/useRunValues.ts`:
  - `:65-66`: `LocalDecision`.
  - `:193-201`: `record`.
  - Call sites `:247`, `:300`, `:339-346` (undo payload and record) and `:349-350` (redo record).
- Modify `frontend/test/components/ExtractionReviewTable.test.tsx:37` and `:127`: add `predecessorLink: null` to both `undoTarget` literals (typed via `ReviewWorkspace['decisions']`).
- Test: `frontend/test/hooks/useRunValues.test.tsx`, with new tests in `'confirmed proposal decisions and local undo'` (`:278`) and assertions added to the renamed `:346` test.

**Interfaces:**
- `interface LocalDecision extends Coord { id; expectedId; predecessorId: string | null; predecessor: Record<string, unknown>; predecessorLink: string | null; value; proposalRecordId: string | null }`
- `type Prior = {id: string | null; value: Record<string, unknown>; link: string | null}`
- `const priorOf = (history: readonly ReviewerDecisionResponse[]): Prior => ({id: history.at(-1)?.id ?? null, value: history.at(-1)?.value ?? {value: null}, link: history.at(-1)?.proposal_record_id ?? null})`
- `record(decision: ReviewerDecisionResponse, prior: Prior, undoable: boolean, redone = false)`. It fills `predecessorId`, `predecessor` and `predecessorLink` from `prior`.
- Call sites:

| Call site | New call |
|---|---|
| write and accept (`:247`, `:300`) | `record(result.data, priorOf(history), true)` |
| undo | `record(decision, {id: null, value: entry.predecessor, link: entry.predecessorLink}, false)` |
| redo | `record(decision, {id: entry.expectedId, value: entry.predecessor, link: entry.predecessorLink}, true, true)` |

- The undo payload is `{value: entry.predecessor, proposal_record_id: entry.predecessorLink}`. The redo payload is unchanged.

- [ ] **Step 1: Write the failing tests.**

```tsx
it('undo of a typed edit made over an accepted AI value restores the AI link', async () => {
  const view = setup({}, {proposals: [aiRow('p1')]});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  act(() => view.result.current.edit('a', 'X'));
  await act(async () => {await view.result.current.saveNow();});
  await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
  expect(requests.at(-1)).toMatchObject({value: {value: 'AI'}, proposal_record_id: 'p1', expected_current_decision_id: '2'});
  expect(view.result.current.isAccepted(proposal)).toBe(true);
});
it('undo after redo restores the redone entry\'s predecessor link', async () => {
  const view = setup({}, {proposals: [aiRow('p1')]});
  await act(async () => {await view.result.current.acceptProposal(proposal);});
  act(() => view.result.current.edit('a', 'X'));
  await act(async () => {await view.result.current.saveNow();});
  await act(async () => {await view.result.current.undoLatestLocalDecision();});
  await act(async () => {expect(await view.result.current.redoLatestLocalDecision()).toBe(true);});
  expect(requests.at(-1)).toMatchObject({value: {value: 'X'}, proposal_record_id: 'p1', expected_current_decision_id: '3'});
  await act(async () => {expect(await view.result.current.undoLatestLocalDecision()).toBe(true);});
  expect(requests.at(-1)).toMatchObject({value: {value: 'AI'}, proposal_record_id: 'p1', expected_current_decision_id: '4'});
});
```

  - In the renamed `:346` test, after each undo, assert `requests.at(-1)?.proposal_record_id` in turn:
    - `'p2'` (undo of the un-accept, predecessor = the p2 accept);
    - `'p1'` (undo of the p2 accept);
    - `null` (undo of the p1 accept).
- [ ] **Step 2: Run them.**
  - Command: `npx vitest run frontend/test/hooks/useRunValues.test.tsx -t "undo of a typed edit|undo after redo|un-accepting B"`
  - Expected: FAIL. Undo sends `proposal_record_id: null` (`:339`).
- [ ] **Step 3: Implement** the signatures in Interfaces. Delete the positional `predecessorId` parameter and the three duplicated `history.at(-1)` reads; `priorOf` replaces them. Add `predecessorLink: null` to the two `ExtractionReviewTable.test.tsx` literals.
- [ ] **Step 4: Run it.**
  - Commands: `npx vitest run frontend/test/hooks/useRunValues.test.tsx frontend/test/components/ExtractionReviewTable.test.tsx` and `npm run typecheck` (`tsconfig.app.json` includes `frontend/`, so test files are checked).
  - Expected: PASS. The existing `:307` test (predecessor without link → `null`, `:315`) and the redo test at `:362` (undo after redo → `null`, `:373`) are unchanged.
- [ ] **Step 5: Commit.** `fix(runs): undo restores the predecessor's AI link`

### Task 5: Gates

- [ ] `npm run test:run`: all green.
- [ ] `npm run typecheck`.
- [ ] `npm run lint`.
- [ ] `npx knip` and `npx knip --production`: both at zero, which confirms `WriteProposalParams.proposalRecordId` left no orphan.
- [ ] Check that no source still reads the deleted field: `grep -rn "proposalRecordId" frontend/hooks frontend/services frontend/lib` should show only `LocalDecision.proposalRecordId` (redo).
- [ ] Not needed: `npm run generate:api-types` (no schema change), the vulture baseline and `check_file_size` (no backend change).
- [ ] E2E guard, run in CI. `frontend/e2e/flows/extraction-review-workspace.ui.e2e.ts:106,113` expects un-accept and undo to write `null`. That holds because its predecessor (a typed `'Original reviewer value'`) is unlinked. Do not edit it.
- [ ] PR body states: "`LINEAGE_EXACT_SINCE` (PR5) = the UTC date of the first prod deploy containing this PR; recorded below after promotion (R21)."

### Task 6: Record the prod promotion date for PR5 (after promotion)

Runs once, after this PR is squash-merged to `dev` and a `dev → main` promotion containing it has merged and deployed (`/ship-spec` with `ceiling=prod`, or the `deploy-release` skill). No code change.

- [ ] Find the squash SHA: `gh pr view <pr2> --json mergeCommit -q .mergeCommit.oid`.
- [ ] Find the first promotion PR that contains it: `gh pr list --base main --head dev --state merged --json number,mergedAt,mergeCommit --limit 20`, then, oldest first, `git -C <main> merge-base --is-ancestor <sha> <mergeCommit.oid>` (exit 0 = contains).
- [ ] Confirm that promotion deployed to prod (the `deploy-release` / `preflight` check). If its deploy failed, use the next promotion whose deploy succeeded.
- [ ] Take the UTC date of that `mergedAt` (`YYYY-MM-DD`) and append to this PR's body: `gh pr edit <pr2> --body "$(gh pr view <pr2> --json body -q .body)"$'\n\n'"LINEAGE_EXACT_SINCE: <YYYY-MM-DD> (prod promotion #<n>)"`.
- [ ] Expected: `gh pr view <pr2> --json body -q .body | grep LINEAGE_EXACT_SINCE` prints the date. PR5 reads it from here.

## Rulings applied

- **R21:** `LINEAGE_EXACT_SINCE` is the prod promotion date, not the merge date (Global Constraints, Task 6). Resolves critic #21.
- **D8:** un-accept restores the predecessor's link and the p1/p2 ping-pong is accepted (Task 3, Review Focus 5); a no-information marker over accepted AI keeps the link (Task 2); the canonicalization UI gap is accepted (Review Focus 6).
- **Critic #10** lists plan 2, but R10 assigns the `reader_instance_ids` walk to PR4; no PR2 change.

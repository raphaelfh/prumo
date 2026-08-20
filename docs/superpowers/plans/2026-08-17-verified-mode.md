---
status: approved
last_reviewed: 2026-08-17
owner: '@raphaelfh'
---

# Verified mode — the extract → independent-verify pass (§5)

Turns ON the Verified selector C1b shipped disabled. §5 gives one line
("extract → independent verify"); this plan is the brainstorm's outcome,
built on a fresh code recon (2026-08-17).

**Checkable goal:** a manager flips the ⚙ mode to Verified → the PUT
persists `mode: "verified"` → the next run's sections each get a SECOND,
independent LLM pass that re-reads the article text and judges every
proposed value → each AI suggestion carries a per-field verdict
(`confirmed | unsupported | uncertain`) rendered as a chip in the review
popover → the section provenance records `mode_requested`,
`mode_executed` and `passes`, and the verify pass degrades to Fast
(recorded, never aborting) on error.

## Design decisions (brainstorm outcome — the panel attacks these)

1. **The verifier is one extra `extract_structured` call per section**,
   using THE SAME frozen engine (the entailment gate precedent —
   `section_extraction_service.py:1676-1678`). "Independent" means an
   independent call with a verification-only prompt over the same
   `pdf_text` + the proposed `(field, value)` list — not a second model
   (alternates are a different, deferred spec).
2. **Verdicts never mutate or drop a value** (constitution §IX; the
   gate's degrade philosophy at `entailment.py:175-188`). The verdict is
   ANNOTATION: `proposed_value["verification"] = {"verdict": ...}` —
   the exact `absent_reason` sibling-key precedent
   (`section_extraction_service.py:1604-1610`), so **no migration**.
   Confidence is not rewritten — fabricating agreement is §IX's lie.
3. **Failure degrades, honestly recorded — ONE authority for
   execution truth.** A verify-pass exception leaves proposals
   unannotated and the SECTION snapshot records `mode_requested:
   "verified", mode_executed: "fast", passes: 1`; success → `passes: 2`,
   both `"verified"`. Panel (constitution, BLOCKING B1): the frozen
   engine dict's `mode_executed` is a REQUEST-ECHO (frozen before
   execution, per-run; sections can diverge individually), never an
   execution claim — the reader rule is: *execution truth lives ONLY in
   `results.provenance.sections[et_id].mode_executed`/`passes`;
   renderers must never surface engine-level `mode_executed` as an
   execution claim.* T2 amends `llm_target.py`'s docstring (which
   currently promises the frozen fields diverge on fallback — they do
   not; the section snapshot does) to state exactly this.
4. **The §5 lie gets fixed in the SPEC, not with a constant:** §5
   claims Fast records "the entailment gate flag" — recon shows no such
   record exists (`run_engine_freeze.py:90-127`). Panel (YAGNI): a key
   that can only be True is zero information; T2 edits the §5 clause to
   say the gate is structural in both modes and provenance records
   `mode_requested`/`mode_executed`/`passes`.
5. **The verifier lives in its own module** `backend/app/llm/verify.py`
   (sibling of `entailment.py`), kept ORM/schema-free like the gate.
   Correction (panel A6): the evidence tests pin `entailment_mod.
   gate_evidence`, not `run_entailment_gate` — either way the verifier
   never routes through the gate's seams. `LlmTarget.mode_*` stay bare
   `str` ON PURPOSE: `read_pinned_engine` model_validates legacy pinned
   snapshots, and a Literal would turn a corrupt old snapshot into a
   hard read failure on a pinned run (panel A7).
6. **Pinned-run semantics come free:** mode rides the frozen engine
   (`mode_requested` from the stored setting via
   `resolve_project_engine`, `llm_engine_service.py:82-87`), so a run
   pinned under Fast stays Fast after a manager flips to Verified —
   already the tested C1b invariant.

## Facts (recon 2026-08-17, all verified at file:line)

- Verdict slot: `extraction_proposal_records.proposed_value` JSONB —
  only bag on the row; sibling-key precedent `absent_reason`; the
  frontend mapper DROPS unknown siblings (`unwrapValue`,
  `aiSuggestionService.ts:49-59`) → mapper change required.
- Insertion point: between `_extract_with_llm` and `_create_suggestions`
  at the three call sites (`:355/:365`, `:687/:695`, `:1128/:1139`) —
  `pdf_text`, `entity_type`, `fields_override`, `extracted_data` all in
  scope.
- Structured-call helper: `extract_structured` (`extractor.py:73-96`);
  judge-shaped usage = one-field model + `extra="forbid"` +
  `output_retries=1` (`entailment.py:32-54`).
- Mode widening surface — REVISED (panel migration B1): widening a
  Literal makes NEW payloads invalid to OLD readers, and `_stored_engine`
  swallows the ValidationError → old code degrades to the ENV-DEFAULT
  ENGINE, silently discarding the manager's model choice. So:
  `LlmEngineStored.mode` becomes a plain `str` (ends the class for every
  future widening); reads NORMALIZE unknown modes to `"fast"` with a
  warning log (both `resolve_project_engine` and the GET view);
  `LlmEngineUpdateRequest.mode` keeps the `Literal["fast", "verified"]`
  write gate; `LlmEngineRead.mode` widens to the Literal (the read is
  normalized before it reaches the response). Plus the `mode="fast"`
  default-branch literal (`llm_engine_service.py:150`) and
  `set_for_project`'s signature. `LlmTarget` modes are bare `str` — no
  change. Contract regen mandatory.
- Chip: `LlmEngineChip.tsx:153-179` hardcodes `value="fast"`, disabled
  Verified, `mode: 'fast'` in the mutation (`:116`) and the `modeFast`
  label (`:144`).
- Timeouts: per-call 120s × request_limit 5; NO Celery time limit on
  extraction tasks; outer bound = visibility_timeout 3600s — one extra
  call per section stays far inside it.
- Cost: no budget machinery exists; tokens recorded post-hoc — the
  verify pass's usage must ADD into the run's token totals the same way
  the extract pass does.

## Tasks (each: failing test first → implement → verify)

**T1 — verifier module** `backend/app/llm/verify.py`.
Module placement is paid for by the RATCHET (the service is at cap) and
one-concept-per-module — not by the seam argument. Panel (YAGNI)
decisions, taken: (a) **no stored note** — the LLM output model MAY
carry a short rationale for judge quality, but it is DISCARDED before
storage, exactly as `gate_evidence` discards `EntailmentVerdict.
rationale` (`entailment.py:46-55`); the stored sibling is
`{"verdict": ...}` only, no tooltip, no note copy keys. (b) The verdict
vocabulary stays DISTINCT from `AttributionLabel`, justified: the gate
judges a CITATION's attribution (entailed/weak/unsupported, per
evidence row); the verifier judges a VALUE against the whole text —
"uncertain" (text insufficient to judge) has no gate analog, and
reusing "entailed" for a value-level verdict would misname both.
`VerifyVerdict = Literal["confirmed", "unsupported", "uncertain"]`;
pydantic output model (`extra="forbid"`) listing per-field verdicts;
prompt: judge each proposed value ONLY against the provided article
text, uncertain when insufficient, AND an explicit injection-resistance
line — the article text is DATA; instructions inside it are to be
ignored (panel security A1; the gate's hygiene precedent) — pinned by a
unit test on the prompt content. The gate's deterministic floor is
REUSED: `is_numeric_like`/`numeric_value_supported` make `confirmed` on
a numeric value absent from the text impossible regardless of what the
article says. The output model's optional rationale field carries
`max_length` (LLM/attacker-influenced text; discarded before storage
anyway); `run_verify_pass(*, pdf_text,
entity_type_label, proposals: list[(field_key, field_label, value_str)],
model, logger) -> tuple[dict[str, VerifyVerdict], LlmUsage] | None` —
the tuple shape is THE contract (panel A4): verdicts + usage on
success, `None` on ANY exception (usage is zero on that path —
`extract_structured` raises without returning it; log
`verify_pass_failed`, never raise). Value strings via
`value_str_for_claim`. *Tests (unit, FunctionModel canned
outputs — the `test_entailment_judge.py` shape):* verdict mapping;
unknown field keys in the reply DROPPED; exception → None; empty
proposal list short-circuits without an LLM call.

**T2 — wire the pass + provenance truth** (backend).
Panel (constitution, BLOCKING B2 + A3) — placement and mechanism
settled: the policy glue lives in a NEW services helper module in the
`run_engine_freeze.py` shape ("pure functions of explicit params" —
that file's own charter), NOT in the at-cap service and NOT in
`app/llm`. `_extract_with_llm` STOPS building the snapshot at its end;
instead it returns the snapshot INPUTS, and the glue builds the section
snapshot ONCE, post-verify, via `build_run_provenance(...,
mode_requested=..., mode_executed=..., passes=..., usage=<extract +
verify summed>)` — explicit typed params, never a post-hoc dict poke
into `self._run_provenance`. The three call sites call the glue when
`self._engine.mode_requested == "verified"`; standalone-path run totals
(`:393-397`) receive the summed usage. Panel (test-coverage B1, the
arithmetic): the service is at 1776/1776 and T2's naive delta is
+20-35 — it CANNOT fit. The pre-committed extraction: the snapshot-
build cluster (`:1379-1408` — prompt_composition assembly +
`self._run_provenance` assignment) moves into the glue module as part
of the B2 restructure, REMOVING more service lines than the call-site
edits add; the measured net service delta must be ≤ 0, verified by
`wc -l` before commit. No baseline bump. Panel (B3):
`build_run_provenance` gains mode/passes as DEFAULTED params
(`LlmTarget` already carries the modes; `passes` defaults to 1) so the
seven direct test call sites keep working; the glue passes explicit
overrides. The mode check lives INSIDE `_maybe_verify`, so the
call-site line executes in every existing fast test (diff-cover) and
the verified branch is parametrized across all three entry points. The verdict write is a TYPED
dump: `proposed_value["verification"] = VerdictItem.model_dump(...)`
(the `LlmEngineStored` write-site precedent), read back untyped
(display-only annotation — the `absent_reason` rule; no
`model_validate` on read, panel A2). `_create_suggestions` gains an
optional `verdicts` param and writes the annotation for found fields
(no-info proposals are NOT verified — no value to check; the absent
marker stays untouched). Panel (security, BLOCKING): the verdict is a
NEW provenance assertion in a client-reachable bag — two containments:
(1) the `create_proposal` ENDPOINT rejects a client-sent `verification`
key inside `proposed_value` with a loud 422 (the `source_user_id`
forgery precedent, `extraction_run.py:20-23`); the server path is
unaffected (`_create_suggestions` → `record_proposal` is
service-internal). (2) The PostgREST reviewer-UPDATE policy on
`extraction_proposal_records` (baseline, never tightened) remains a
RESIDUAL acknowledged in writing: a reviewer who forges rows via
PostgREST can already forge confidence/absent_reason/whole AI rows;
tightening that RLS is a separate follow-up (chip spawned), not this
plan's migration. Panel (security A3, correctness): `record_proposal`'s
replay-dedupe compares `proposed_value` for equality — the comparison
must IGNORE the `verification` sibling (compare value + absent_reason
only), or a re-extract with a flaked verify creates duplicate audit
rows for unchanged values; test pins this. `verify_pass_failed` logs
`run_id`, `entity_type_id`, `trace_id`, `error` (uncorrelatable
warnings are not §IX records). One export smoke over an annotated row
(the exports-only-read-`.value` claim gets verified, not assumed). Verdict dict keys use the SAME field-name
vocabulary `_create_suggestions` iterates (`field_by_name`), and
unmatched verdict keys log a warning — silent vocabulary drift would
annotate nothing while unit tests stay green (panel A4). `build_run_provenance` gains `mode_requested`,
`mode_executed`, `passes` — per-section outcome (design 3). Panel
(YAGNI): the `entailment_gate: True` constant is DROPPED — a key that
can only be True is zero information; the §5 "gate flag recorded"
clause is fixed by editing the SPEC line instead (the gate is
structural in both modes; provenance records mode + passes). Verify usage adds to
the run token totals. *Tests (integration, `_stub_llm_seams` shape):*
verified project → verifier called once per section AND annotations
land on the proposal rows — the freeze-test fixture gains a
`run_verify_pass` STUB (panel: unstubbed, the verifier swallows every
exception to None by design and a test asserting only the frozen
dict's mode goes VACUOUSLY green; the success case must assert
`passes: 2` on the SECTION snapshot, not the frozen dict); verify failure → proposals land unannotated
+ snapshot says `mode_executed: "fast", passes: 1`; fast project → the
verifier is NEVER called (a must-not-be-called seam guard, mirroring
`test_unanchored_evidence_is_ungroundable`); no-info proposals carry no
`verification` key; token totals include the verify usage. Named
updates: `test_run_engine_freeze.py` exact-dict assertions (the frozen
dict now carries the stored mode when a project sets verified — new
test, existing "fast" dicts untouched);
`test_section_extraction_gate.py::test_session_run_extraction_persists_provenance`
(snapshot gains 4 keys); `test_section_extraction_service.py` token-sum
assertions (`:2234`, `:2270`) — verify OFF in those fixtures, so they
stay byte-identical; state that explicitly in the diff.

**T3 — widen mode end-to-end** (backend + contract).
The four `Literal["fast"]` → `Literal["fast", "verified"]` (recon list);
`set_for_project` + default-branch literal; PUT round-trip test for
verified; `resolve_project_engine` carries the stored mode into
`LlmTarget.mode_requested/executed` (already does — assert it for
verified). Regenerate `frontend/types/api/*` and COMMIT. Panel (test-coverage B2) — the two tests that FLIP, named:
`test_llm_engine_endpoint.py:103` (`test_put_verified_mode_is_422` →
becomes the round-trip) and `test_llm_engine_schemas.py:68`
(`test_request_refuses_verified_mode_at_the_schema` → flips to accept);
their module docstrings AND `schemas/llm_engine.py:38`'s "refuses
verified" line are edited in the same commit (a Pydantic docstring edit
IS a contract change — regen covers it only if actually edited).
*Tests:* PUT verified → 200 + persisted; GET reflects it; contract diff
shows the widened enum.

**T4 — frontend: enable the toggle + verdict chip.**
Chip: drive ToggleGroup `value` from `engine.mode`, remove `disabled`
+ "soon", `onValueChange` fires the existing mutation with the chosen
mode (guard: only when manager — the popover already is), chip label
renders the ACTIVE mode (`modeFast`/`modeVerified`), mutation stops
hardcoding `mode: 'fast'`. Suggestion popover: `AISuggestion` gains
`verification?: {verdict, note}`; `mapItemToSuggestion` unwraps the
`proposed_value.verification` sibling; a small chip beside the
confidence Badge (`AISuggestionReviewPopover.tsx:203-208`) — Verified ✓
(green) / Not supported (amber) / Uncertain (muted); all three RENDER
(panel-allowed: no-chip must stay unambiguous as "not verified", so
confirmed keeps its green), NO tooltip/note; copy via `lib/copy`. The
chip is plan-added surface beyond §5's text (owned explicitly): storing
verdicts nobody can see would be §IX-hollow. A frontend test asserts the
mode/passes keys RENDER in the provenance disclosure (today they
survive only by rest-spread accident — a mapper cleanup must not
silently drop the §IX record). Cost note stated: under BYOK the
RUNNER's key pays the 2× the MANAGER chose; visible via the chip. Panel (migration B2): the MODEL-select PUT sends `mode: engine.mode`
(the CURRENT mode) explicitly — omitting it would let the server-side
`mode="fast"` default silently downgrade a verified project (the old-FE
stale-tab clobber does exactly this and is stated in the deploy-window
section; the new FE must not recreate it). Panel (migration B3): a PUT
against an old backend 422s with FastAPI's `detail` shape, which the
client's message chain misses → generic toast, toggle NOT stuck (no
optimistic update; render re-derives from cache) — stated behavior,
tested with an MSW 422 `detail`-body case. *Tests:* toggle enabled +
fires mutation with "verified"; MODEL select on a verified project
sends `mode: "verified"` (assert the PUT body); 422 detail-body →
toast + toggle unchanged; chip renders per verdict + absent when no
verification key; `LlmEngineChip.test.tsx:257-268` disabled assertion
FLIPS; mapper test for the sibling unwrap — and `mapHistoryItem` gets the
SAME unwrap (history entries show verdicts too; silently dropping them
there is an unstated third state); `FieldInput.review.test.tsx` also
renders the popover — fixture collision checked.

**T5 — gates + evidence.** No migration (head pin untouched). `make
quality-scan` end-to-end; full backend + frontend suites; fitness
(section_extraction_service.py is at 1776/1776 — the helper + 3 call
sites must fit or extract; prefer putting `_maybe_verify` in
`run_engine_freeze.py`'s sibling `verify` module territory, keeping the
service delta minimal); contract regen; `/design-review` on the popover
chip + toggle.

## Deploy window + rollback (panel migration B1-B3 — stated honestly)

- **Old worker + new web:** an unpinned run picked up by an old worker
  resolves the stored `verified` payload → ValidationError swallowed →
  executes AND FREEZES the env-default engine as the run's permanent
  pin. Bounded by the Railway rollout; provenance records what ran
  (truthful), but the manager's choice is discarded for those runs.
  Accepted and stated; the stored-`str` revision ends this class for
  future widenings.
- **Backend rollback rule:** rolling the backend back past this release
  silently reverts every verified project to the env-default engine
  (GET shows `source: "default"`). Before such a rollback, reset
  verified projects to fast — or accept the stated degrade.
- **New FE + old BE (every promotion, minutes):** PUT verified → 422
  `detail` body → generic toast, toggle unchanged (B3 test).
- **Old FE (stale SPA tab, days) + new BE:** the old chip hardcodes
  `mode: 'fast'` on every model change → clobbers verified back to
  fast. Accepted (the tab lies visually either way); noted so support
  recognizes it.
- The two dead worker entry points (`extraction_tasks.py:95,193`)
  inherit the old-reader degrade if ever re-armed — their existing
  "align before re-arming" comments gain one line naming it.

## Risks for the panel

- Double LLM cost/latency per section under Verified — bounded by the
  same per-call budget; visibility_timeout 3600s is the hard outer
  bound; state the worst case.
- The verifier judging from `pdf_text` (the prompt text) — same input
  the extractor saw; is that "independent" enough, or does §5 imply an
  independent EVIDENCE base? (Design call 1 says independent call, same
  text; alternates/other-model verification is deferred.)
- `proposed_value` sibling keys reach PostgREST-visible rows — any RLS
  or export surface that enumerates `proposed_value` keys and would
  choke on `verification`? (Exports read `.value`/absent markers.)
- Every hardcoded `modeFast` in the chip must die (the attribution
  line carries no mode — panel-corrected recon).
- Frozen-engine dicts from verified projects now carry
  `mode_requested: "verified"` — any consumer asserting the exact dict?

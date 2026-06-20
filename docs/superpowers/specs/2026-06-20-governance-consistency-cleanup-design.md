---
status: draft
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Governance & Context-Consistency Cleanup — Design Spec

> **Status:** Draft · Last reviewed: 2026-06-20 · Owner: @raphaelfh

> This document is the **read-only audit output** (an Inconsistency Map +
> a spec-ready cleanup backlog) plus a proposed spec a human can ratify.
> No corpus file was edited to produce it. `status: draft` is used
> deliberately because it is the one value valid under the *current*
> declared enum (see finding **A5**) — the spec proposes to widen that enum.

---

## 1. Context & problem

The agent-facing knowledge corpus (root governance, rules, constitution,
ADRs, reference docs, specs, plans, the Diátaxis index, agent memory, and CI
governance) has drifted from the code/CI/git ground truth it describes.
Because agents load this corpus *before* touching code, a contradiction here
makes an agent do the wrong thing — chase a coverage gate CI does not enforce,
re-implement already-merged work, copy a wrong production env value, or trust a
"source of truth" that is stale. This audit maps every inconsistency and
clusters them into a cleanup that makes the corpus **cheaper to maintain and
non-contradictory**, so the goal is fewer authoritative copies, enforced
conventions, and lifecycle status that tracks reality.

This pass is **read-only**: it does not fix anything. A human ratifies the
backlog, then `/writing-plans` turns it into an executable plan.

## 2. Method & scope

- **Corpus audited (109 files):** `CLAUDE.md`, `llms.txt`, `README.md`;
  `.claude/rules/{backend,frontend}.md`; `docs/reference/*` (+ `templates/`);
  14 ADRs (`0000`–`0013`); 19 specs + 19 plans under `docs/superpowers/`
  (archives excluded); `docs/README.md`, `docs/ROADMAP.md`, `docs/how-to/*`;
  CI governance (`docs-ci.yml`, `.markdownlintignore`, `cspell.json`); and the
  35 agent-memory files + `MEMORY.md` (outside the repo).
- **Ground truth:** every load-bearing claim was verified against
  `backend/app/**`, `.github/workflows/ci.yml`, `git log`/HEAD ancestry, and
  the corpus itself — **33 verdicts**, all cited to `file:line` / workflow /
  commit. Where verification was incomplete the finding is marked
  `confidence: medium|low` and names the missing evidence.
- **Excluded (out of scope):** `*/archive/**`, `node_modules/`,
  `playwright-report/`, `test-results/`.
- **Mechanics:** a multi-phase read-only agent workflow (parallel inventory +
  ground-truth verifiers → 7 class detectors A–G → dedup/cluster synthesis →
  adversarial completeness critic), plus deterministic spot-checks run by hand
  (status-value census, memory dead-pointer sweep, the critical A2 UUID).

## 3. Executive summary

**41 findings** (deduped from 51 raw) across the taxonomy:

| Severity | Count | | Primary class | Count |
| --- | --- | --- | --- | --- |
| Critical | 1 | | A — Factual contradiction | 8 |
| High | 7 | | B — Lifecycle / status drift | 17 |
| Medium | 22 | | D — Structural / taxonomy | 8 |
| Low | 11 | | E — Redundancy / bloat | 2 |
| **Total** | **41** | | F — Orphans / dead pointers | 6 |

> Classes **C** (vocabulary) and **G** (conventions) carry no *primary*
> findings — every status-enum / convention issue merged into **A5/A5b**
> (vocabulary) or into **D/F** records (conventions) as a secondary class.

**Top 5 agent-misleading contradictions** (would make an agent act wrongly):

1. **A2 (critical)** — `deployment.md:113` documents the **wrong Linear team
   UUID** for `LINEAR_TEAM_ID`; copying it mis-routes *all* in-app feedback to
   the GitHub-sync team. Silent prod misconfig.
2. **B1 (high)** — `CLAUDE.md` "Current focus" (the first governance file an
   agent reads) names **shipped** work as active and points at stale "active"
   plans → an agent re-does/extends already-merged consolidation.
3. **A3 (high)** — `apiKeysService.ts` reads `errorData.detail`, which is
   *always undefined* under the live envelope → an agent copying it inherits a
   pattern that **masks real server errors** and violates the documented rule.
4. **A1 (high)** — the **non-negotiable constitution self-contradicts** on a
   hard number (`--cov-fail-under=70` at line 187 vs the real **62**),
   training agents to discount its MUSTs.
5. **A5 (high)** — the declared 6-value doc **status enum** is contradicted by
   9 real out-of-enum values across ~26 files and is **unenforced** → an agent
   string-matching `status` misjudges what is done.

**Confirmed-clean true negatives** (verified, no finding warranted):
ADR supersession chains all resolve (no broken `Superseded by`); `ROADMAP.md`
exists and `docs/README.md` index targets all exist; backend error envelope and
the typed FE client genuinely emit/read `error.message`; coverage ratchet
62/80/85, mypy-advisory, blocking FE typecheck, migration-boundary script, and
the startup migration gate all match the constitution.

**Deterministic corrections folded in** (hand-verified, supersede agent
estimates): the status census is **14 distinct in-scope frontmatter values, 9
out-of-enum** (`accepted, approved, completed, implemented, in-progress,
planned, proposed, ready, template`) across **~26 files**, with `deprecated`
**declared-but-never-used** and a lone `in-progress`(hyphen) vs `in_progress`
split — pass-1's "14/9" was right for in-scope files; the critic's "20" wrongly
counted archives. Memory carries **5 dead doc pointers** (not 1).

## 4. Inconsistency Map

Format per record: **[ID] title** — `class` (+secondary) · **severity** ·
confidence · _simplification_ → sources · conflict · resolution (source of
truth).

### Critical

**[A2] `deployment.md` `LINEAR_TEAM_ID` points at the Prumo team UUID, but live config routes feedback to the Feedback team** — `A` · **critical** · high · _single-source_
- **Sources:** [deployment.md:113](docs/reference/deployment.md:113) ⟷ [linear-integration-design.md:37-39](docs/superpowers/specs/2026-05-30-linear-integration-design.md:37) ⟷ [feedback_tasks.py:59](backend/app/worker/tasks/feedback_tasks.py:59) ⟷ memory `reference_feedback_linear_config`
- **Conflict:** `deployment.md:113` lists `LINEAR_TEAM_ID` = Prumo `9b86c9ed-…`. The *implemented* (`status: implemented`) linear-integration spec and the live worker config set it to the **Feedback team `23d83039-…`** (key FEE), read at `feedback_tasks.py:59`; memory confirms FEE is live in prod. Same env var, two UUIDs — the doc value silently mis-routes all feedback. **Authoritative: live config + implemented spec.**
- **Resolution:** Update `deployment.md:113` to `23d83039-…` and note the Prumo team is GitHub-sync/automation, not the feedback target. _SoT: running Railway worker env._

### High

**[A1] Constitution CI-Pipeline says `--cov-fail-under=70`, but CI enforces 62 (and the same doc's tooling table says 62)** — `A` (+B) · **high** · high · _single-source_
- **Sources:** [constitution.md:187](docs/reference/constitution.md:187) ⟷ [constitution.md:160](docs/reference/constitution.md:160) ⟷ [ci.yml:245](.github/workflows/ci.yml:245) (+history comment ci.yml:216-229)
- **Conflict:** Line 187 asserts 70; the same doc's tooling table (160) + amendment note (234-236) say 62; CI runs `--cov-fail-under=62`. Self-contradiction inside a non-negotiable doc. **Authoritative: ci.yml.**
- **Resolution:** Edit `constitution.md:187` to 62 or replace the literal with a pointer to ci.yml/line 160. _SoT: ci.yml._

**[A3] `apiKeysService` reads FastAPI `errorData.detail`, contradicting the envelope rule / ADR-0008 (`error.message`)** — `A` (+C) · **high** · high · _single-source_
- **Sources:** [apiKeysService.ts:102,130,151,175](frontend/services/apiKeysService.ts:102) ⟷ [error_handler.py:233-243](backend/app/core/error_handler.py:233) ⟷ `.claude/rules/backend.md` (API contract)
- **Conflict:** Rule/constitution/ADR-0008 mandate reading `error.message` "not FastAPI default `detail`". The handler remaps `HTTPException(detail=…)` into `error.message`, so top-level `detail` is always undefined → the four reads fall through to a generic string, masking the real message. The same file's *success* branch correctly reads `data.error?.message`. **Authoritative: code/envelope.**
- **Resolution:** Replace the four `errorData.detail` reads with `errorData.error?.message`, or route through the typed client. _SoT: error_handler.py._

**[A5] Declared 6-value status enum contradicted by 9 out-of-enum values across ~26 files; unenforced; `deprecated` dead; competes with the ADR MADR lifecycle** — `A` (+C,F,G) · **high** · high · _single-source_
- **Sources:** [docs/README.md:69-70](docs/README.md:70) ⟷ [0001-use-madr.md:28](docs/adr/0001-use-madr.md:28) ⟷ 26 frontmatter sites (ADRs `accepted`/`proposed`/`template`; plans/specs `approved`/`implemented`/`completed`/`planned`/`ready`) ⟷ [check-frontmatter.sh](scripts/docs/check-frontmatter.sh)
- **Conflict:** README declares `stable·draft·deprecated·shipped·frozen·in_progress` and claims every doc carries one. Real in-scope frontmatter uses 14 distinct values; **9 are out-of-enum**; `deprecated` is declared but never used. ADRs validly follow a *separate* MADR lifecycle (0001:28), proving one flat enum cannot model all layers. docs-ci checks **presence only**, never value. **Authoritative: real frontmatter + MADR.**
- **Resolution:** Re-author README:70 as **per-layer** subsets (reference/how-to; ADR-MADR; plan/spec), prune dead `deprecated`, and add a status-VALUE check to `check-frontmatter.sh` so the enum is enforced not narrated. _SoT: docs/README.md:70 + the CI check._

**[B1] `CLAUDE.md` "Current focus" + `ROADMAP` "Current cycle" name shipped consolidation as active, pointing at stale plans (duplicated across two files)** — `B` (+A,E) · **high** · high · _re-status_
- **Sources:** [CLAUDE.md:11-14](CLAUDE.md:11) ⟷ [ROADMAP.md:21](docs/ROADMAP.md:21) ⟷ git `1fa2e00` (#324, in HEAD), `a991ed4` (#228, in HEAD) ⟷ [extraction-data-path-finish.md:2](docs/superpowers/plans/2026-06-19-extraction-data-path-finish.md:2) (`completed`)
- **Conflict:** "Extraction data-path consolidation (approved 2026-06-07)" with "Active plans: …runopen-slowload-phase*" is shipped (#228, #324 in HEAD; finish plan `completed`). ROADMAP restates the same milestone unchecked. Two stale copies double the drift surface; this is the first file an agent reads. **Authoritative: git/merged PRs.**
- **Resolution:** Make ROADMAP the single current-cycle source (move consolidation to "Recently shipped"), reduce CLAUDE.md "Current focus" to a one-line ROADMAP pointer aimed at the genuinely-active PDF-ingestion/parsing work (ADR-0011/0013, commit 97fd23e). _SoT: git log + docs/adr._

**[B3] runopen-slowload Phase 2 (RunView) plan still `in_progress` though shipped via #228/#324** — `B` · **high** · high · _re-status_
- **Sources:** [phase2-runview.md:2](docs/superpowers/plans/2026-06-08-runopen-slowload-phase2-runview.md:2) ⟷ git `a991ed4` (#228 "Phase 2 — RunView server-side collapse"), `1fa2e00` (#324) ⟷ `backend/app/schemas/extraction_run.py` (RunViewResponse) ⟷ `backend/app/api/v1/endpoints/extraction_runs.py`
- **Conflict:** Frontmatter `in_progress`; #228 is literally that phase and is in HEAD; the `RunViewResponse`, the `GET /runs/{id}/view` endpoint, and the read service all exist; deferred Task 12 landed in #324. **Authoritative: git + source.**
- **Resolution:** Re-status to `shipped` or archive. _SoT: extraction-hitl-architecture.md + the live RunViewResponse._

**[D1] Root-index triplication: stack + hard-rules + read-first routing duplicated (and already drifted) across `CLAUDE.md`, `llms.txt`, `README.md`, `docs/README.md`** — `D` (+A,E) · **high** · high · _single-source_
- **Sources:** [CLAUDE.md:18-26,46-62,64-77](CLAUDE.md:18) ⟷ [llms.txt:3-25](llms.txt:3) ⟷ [README.md:28-34,89-97](README.md:28) ⟷ [docs/README.md:29-46](docs/README.md:29)
- **Conflict:** Three fact-blocks are hand-maintained in 3–4 files and already disagree — README adds `gunicorn+uvicorn` and `Tailwind` that CLAUDE.md omits; the read-first routing table differs in coverage (CLAUDE.md omits deployment.md + test-strategy.md). No file is declared the single source. **Authoritative: none declared — that is the defect.**
- **Resolution:** Make CLAUDE.md the single source for stack + hard rules and docs/README.md the single source for the doc index/routing table; reduce llms.txt + README.md to one-line pointers + a short curated "must-read before touching extraction" set. _SoT: CLAUDE.md (rules) + docs/README.md (index)._

**[F1] Autoloop design spec has 4 broken links to a non-existent `docs/architecture/` directory** — `F` (+G) · **high** · high · _relocate_
- **Sources:** [autoloop-design.md:20,259](docs/superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md:20) ⟷ `ls docs/architecture/` → no such dir (files live under `docs/reference/`)
- **Conflict:** The spec links `../../architecture/{extraction-hitl-architecture,migrations,test-strategy}.md` — but `docs/architecture/` does not exist; an agent following them to "align with invariants" hits 404s pointing at the single most load-bearing reference doc. **Authoritative: docs/reference/.**
- **Resolution:** Repoint all four `../../architecture/…` links to `../../reference/…`. _SoT: docs/reference/._

### Medium

**[A1b] Constitution lists only 5 CI jobs; CI defines ~13** — `A` (+B) · medium · high · _single-source_
- **Sources:** [constitution.md:182-192](docs/reference/constitution.md:182) ⟷ ci.yml:71,94,324,484,508,616 (Architectural Fitness REQUIRED, Backend/Frontend E2E, API Contract, …)
- **Conflict:** The 5-job enumeration ("every gate") omits architectural-fitness, diff/critical-path coverage, frontend tests/E2E, and API-contract drift — gates the doc's own tooling table references. An agent under-models the real gate surface. **Authoritative: ci.yml.**
- **Resolution:** Replace the hand-maintained list with a pointer to ci.yml. _SoT: ci.yml._

**[A2c] `deployment.md` CORS lists `prumo-alpha.vercel.app`, but the live prod origin is `prumoai.vercel.app`** — `A` (+E) · medium · **medium** · _clarify_
- **Sources:** [deployment.md:104](docs/reference/deployment.md:104) ⟷ memory `reference_prod_frontend_cors:10-14`
- **Conflict:** Doc sets web `CORS_ORIGINS=https://prumo-alpha.vercel.app`; memory records the live frontend as `prumoai.vercel.app` (drift prumo→prumo-alpha→prumoai). **Medium confidence: did not read the live Railway `CORS_ORIGINS` to confirm whether the running allow-list also lacks prumoai.**
- **Resolution:** Update to `prumoai.vercel.app` (or list all allow-listed origins) **after** cross-checking the live Railway env. _SoT: running Railway env + live origin._

**[B2] runopen-slowload Phase 1 plan still `in_progress` though the dedup intent shipped (#224/#324)** — `B` · medium · **medium** · _re-status_
- **Sources:** [phase1.md:2](docs/superpowers/plans/2026-06-08-runopen-slowload-phase1.md:2) ⟷ git `c2143e5` (#224 "…slow-load dedup"), `1fa2e00` (#324)
- **Conflict:** Dedup intent shipped via #224 and the consolidation that subsumes the run-open path (#324, "zero supabase reads remain"). **Medium: no squash commit is titled "phase 1"; attribution is inferential — a PR-body/checkbox audit would pin it.** **Authoritative: git.**
- **Resolution:** Verify via PR bodies, then re-status to `shipped`/archive. _SoT: data-path-finish plan._

**[B4] react-compiler-enablement plan still `in_progress` though shipped (#268)** — `B` · medium · high · _re-status_
- **Sources:** [enablement.md:2](docs/superpowers/plans/2026-06-11-react-compiler-enablement.md:2) ⟷ git `c281ce3` (#268) ⟷ `package.json:104` (`babel-plugin-react-compiler ^1.0.0`) ⟷ `vite.config.ts:48-49`
- **Conflict:** #268 in HEAD; compiler is a live dep wired in vite. **Authoritative: git + live dep.** → Re-status `shipped`/archive.

**[B5] react-compiler-zero-bailouts plan still `approved` though shipped (#269/#270)** — `B` · medium · high · _re-status_
- **Sources:** [zero-bailouts.md:2](docs/superpowers/plans/2026-06-11-react-compiler-zero-bailouts.md:2) ⟷ git `29e786e` (#269), `2e9d269` (#270) ⟷ `vite.config.ts:48-49` (`panicThreshold 'all_errors'` permanent)
- **Conflict:** `approved` = pre-implementation, but both PRs are in HEAD and the all_errors gate is permanent. **Authoritative: git.** → Re-status `shipped`/archive.

**[B6] extraction-llm-stack-migration plan still `ready` though shipped (#266)** — `B` · medium · high · _re-status_
- **Sources:** [migration.md:2](docs/superpowers/plans/2026-06-11-extraction-llm-stack-migration.md:2) ⟷ git `aa71e6b` (#266) ⟷ `backend/app/llm/` ⟷ `backend/pyproject.toml` (`pydantic-ai-slim[openai]`, `logfire`)
- **Conflict:** Breaking-change migration PR in HEAD; `app/llm/` + deps live. **Authoritative: git + module.** → Re-status `shipped`/archive.

**[B7] manager-blind-review (`draft`) and blind-review-cleanup (`proposed`) both shipped (#318/#319/#320)** — `B` · medium · high · _re-status_
- **Sources:** [manager-blind-review.md:2](docs/superpowers/plans/2026-06-19-manager-blind-review.md:2), [blind-review-cleanup.md:2](docs/superpowers/plans/2026-06-19-blind-review-cleanup.md:2) ⟷ git `f9af2de`/`2adc3d0`/`0e6c914` (#318/#319/#320) ⟷ `backend/app/api/v1/endpoints/manager_review_visibility.py`
- **Conflict:** Endpoint + service + schema present; ADR-0012 (accepted) records the shipped decision. **Authoritative: git + ADR-0012.** → Re-status both `shipped`/archive.

**[B8] in-app-feedback-to-linear plan still `draft` though shipped (#164); also targets the wrong Linear team** — `B` (+A) · medium · high · _re-status_
- **Sources:** [plan:2,11](docs/superpowers/plans/2026-05-30-in-app-feedback-to-linear.md:2) ⟷ git `25922fc` (#164) ⟷ `backend/app/api/v1/endpoints/feedback.py` ⟷ `router.py:115-116`
- **Conflict:** Full backend shipped; sibling spec already `implemented`. Plan targets "Prumo (PRU)" team but live routes to FEE (see A2). **Authoritative: git + live worker config.** → Re-status `shipped`/archive and fix team target to FEE.

**[B9] e2e-fixture-self-provisioning plan still `draft` though shipped (#170)** — `B` · medium · high · _re-status_
- **Sources:** [plan:2](docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md:2) ⟷ git `8b0b480` (#170), follow-ups `024285f`/`bd6ca22` (#326/#328) ⟷ `frontend/e2e/_fixtures/ensure-fixtures.ts`
- **Conflict:** #170 in HEAD; `ensure-fixtures.ts` exists; memory records the gap CLOSED. **Authoritative: git + fixture file.** → Re-status `shipped`/archive.

**[B10] publication-ready-xlsx-export plan still `draft` though shipped (#292)** — `B` · medium · high · _re-status_
- **Sources:** [plan:2](docs/superpowers/plans/2026-06-14-publication-ready-xlsx-export.md:2) ⟷ git `a73e3df` (#292), fixes #298/#300/#302 ⟷ `backend/app/services/exports/extraction/`
- **Conflict:** Builder package exists exactly as specified. **Authoritative: git + package.** → Re-status `shipped`/archive.

**[B12] test-infra-hardening spec: frontmatter `in-progress` + body "Draft" but Layer-1/2 work shipped (`de3b985`)** — `B` (+A) · medium · high · _re-status_
- **Sources:** [spec:2,10](docs/superpowers/specs/2026-05-24-test-infra-hardening-design.md:2) ⟷ git `de3b985` ⟷ `backend/tests/conftest.py:132,165`
- **Conflict:** Two-source internal status mismatch (frontmatter vs body banner) on work that shipped (SAVEPOINT `db_session` + `db_session_real`); only Layer 3 (xdist) is out of scope. **Authoritative: git + conftest.** → Re-status `shipped`, make body match frontmatter, normalize value (see A5b).

**[D2] `observability-extraction.md` is misfiled under `how-to/` — it is a reference metrics catalog (and carries two H1s)** — `D` · medium · high · _relocate_
- **Sources:** [how-to/observability-extraction.md:9,36,74-117](docs/how-to/observability-extraction.md:9) ⟷ [docs/README.md:27](docs/README.md:27)
- **Conflict:** Filed in the "How-to — task recipes" quadrant, but content is overwhelmingly reference (metrics catalog, instrumented-point inventory, baseline log); only one 5-step block is a recipe. Two H1s (legacy `evaluation_*` vs `extraction_*` vocabulary) — two docs concatenated. **Authoritative: Diátaxis intent in docs/README.**
- **Resolution:** Move to `docs/reference/observability-extraction.md`, extract/keep the recipe as a subsection, demote one H1, reconcile vocabulary, update the index row. _SoT: docs/README.md._

**[D4] `last_reviewed` maintained twice per doc (frontmatter + visible body line); already drifted ~17 days in ROADMAP.md and migrations.md** — `D` (+F,C) · medium · high · _single-source_
- **Sources:** [docs/README.md:69](docs/README.md:69) ⟷ [ROADMAP.md:3,9](docs/ROADMAP.md:3) ⟷ [migrations.md:3,7](docs/reference/migrations.md:3) ⟷ [check-staleness.sh:31](scripts/docs/check-staleness.sh:31)
- **Conflict:** Convention mandates both YAML `last_reviewed` and a visible body line; the copies diverged (ROADMAP fm `2026-06-10` vs body `2026-05-24`; migrations identical drift). docs-ci reads only frontmatter, so the human-visible banner silently lags. **Authoritative: frontmatter (CI consumes it).**
- **Resolution:** Drop/generate the visible "Last reviewed" body line and fix the two drifted bodies. _SoT: frontmatter._

**[D6] `docs/README.md` labels the specs/plans dirs "Active" — a coarse status that duplicates per-file frontmatter and has drifted** — `D` (+F) · medium · high · _single-source_
- **Sources:** [docs/README.md:52-53](docs/README.md:52) ⟷ several plans now shipped (data-path-finish, react-compiler-enablement, manager-blind-review)
- **Conflict:** "Active design specs / implementation plans" restates lifecycle that belongs to per-file frontmatter and has drifted (many "active" plans are shipped). **Authoritative: per-file frontmatter.**
- **Resolution:** Describe dirs neutrally; let frontmatter own lifecycle (optionally a generated list). _SoT: per-file frontmatter._

**[E4] Memory `reference_railway_deploys_from_main` duplicates `deployment.md` + ADR-0004, overlaps `reference_ci_pr_mechanics`; contains a dead `docs/architecture/` pointer** — `E` (+C,F) · medium · high · _single-source_
- **Sources:** memory `reference_railway_deploys_from_main:10-103,100` ⟷ memory `reference_ci_pr_mechanics:41-54` ⟷ [deployment.md:200-237](docs/reference/deployment.md:200) ⟷ [0004-hosting-render-to-railway.md:21-43](docs/adr/0004-hosting-render-to-railway.md:21)
- **Conflict:** Restates deploy topology/coverage gates/alembic-on-deploy owned by deployment.md + ADR-0004 and the dev→main promotion already in `reference_ci_pr_mechanics`; and points at dead `docs/architecture/deployment.md` (real file `docs/reference/deployment.md`). **Authoritative: repo docs.**
- **Resolution:** Trim memory to durable non-doc nuggets (SKIPPED-SHA recovery, broken `--path-as-root`, `railway up` from root) + link to deployment.md; fix the dead pointer. _SoT: deployment.md._

**[E6] Arch-doc ConsensusRule glossary overstates a backend gate the finalize code does not implement; memory's "ONLY gate" framing is half-stale post-ADR-0009** — `B` (+E,G) · medium · high · _clarify_
- **Sources:** [extraction-hitl-architecture.md:390-391](docs/reference/extraction-hitl-architecture.md:390) ⟷ [run_lifecycle_service.py:214-246](backend/app/services/run_lifecycle_service.py:214) ⟷ `extraction_consensus_service.py:48-122` ⟷ [0009:24-26](docs/adr/0009-extraction-finalize-completeness-gate.md:24) ⟷ memory `reference_hitl_config_inert:27-31`
- **Conflict:** Glossary says ConsensusRule "Drives when consensus triggers and how it resolves" — implying a quorum gate; but finalize only checks `consensus_count == 0` + an extraction-only completeness gate, and neither `consensus_rule` nor `reviewer_count` is read in the finalize/consensus path (inert). Separately the memory's "ONLY gate is consensus_count==0" is now half-stale (ADR-0009 added the second gate). **Authoritative: code.**
- **Resolution:** Reword the glossary so ConsensusRule is "stored/frozen but inert", note the two-stage finalize gate; update the memory's "ONLY gate" line. _SoT: arch doc + ADR-0009._

**[F2] `ROADMAP.md` and the frozen HITL spec point to non-existent `docs/planos/ROADMAP.md` (incl. a dead "line 130" citation)** — `F` · medium · high · _clarify_
- **Sources:** [ROADMAP.md:35](docs/ROADMAP.md:35) ⟷ [hitl-and-qa-design.md:25,420](docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md:25) ⟷ `ls docs/planos/ROADMAP.md` → none
- **Conflict:** Three refs point at `docs/planos/ROADMAP.md`; the frozen spec cites a specific "line 130" of a file that no longer exists. **Authoritative: docs/ROADMAP.md.**
- **Resolution:** Mark the frozen-spec citations historical/retired or strike the dead line cite (prefer an editor's note over editing a frozen doc). _SoT: docs/ROADMAP.md._

**[F4] E2E fixture plan instructs editing/creating `docs/reference/tests.md`, which does not exist (real file is `test-strategy.md`)** — `F` (+G) · medium · high · _single-source_
- **Sources:** [plan:34,446,493](docs/superpowers/plans/2026-05-30-e2e-fixture-self-provisioning.md:34) ⟷ [test-strategy.md](docs/reference/test-strategy.md)
- **Conflict:** Plan repeatedly targets `docs/reference/tests.md` ("if none exists, create…"); the actual testing reference is `test-strategy.md`. An agent taking the literal default spawns a duplicate testing doc. **Authoritative: test-strategy.md.**
- **Resolution:** Name `test-strategy.md` directly; drop the create-`tests.md` branch. _SoT: test-strategy.md._

**[F5] Implemented review-stage plan points to placeholder ADR `ADR-00XX` instead of the real ADR-0010** — `B` (+F,E) · medium · high · _re-status_
- **Sources:** [plan:70,485](docs/superpowers/plans/2026-06-18-extraction-review-stage-restore.md:70) ⟷ [0010-extraction-review-stage-for-collaboration.md](docs/adr/0010-extraction-review-stage-for-collaboration.md)
- **Conflict:** `status: implemented` plan still lists `ADR-00XX-extraction-review-stage.md` as an artifact "to Create"; the decision is in ADR-0010. An agent would think the ADR was never written and duplicate it. **Authoritative: ADR-0010.**
- **Resolution:** Replace the two placeholders with ADR-0010 and mark the artifact row done. _SoT: ADR-0010._

**[G4] `llms.txt` declares the universal frontmatter convention but carries no frontmatter, and the gate cannot catch it (`.md`-only glob)** — `F` (+G) · medium · high · _clarify_
- **Sources:** [llms.txt:1,38](llms.txt:1) ⟷ [docs/README.md:69](docs/README.md:69) ⟷ [check-frontmatter.sh:35](scripts/docs/check-frontmatter.sh:35)
- **Conflict:** `llms.txt:38` states "Every doc carries status/last_reviewed/owner frontmatter", yet `llms.txt` begins with an H1 and has none; the gate globs `*.md` so a `.txt` entry file is invisible to enforcement. Self-violation is permanent and silent. **Authoritative: the stated rule.**
- **Resolution:** Add frontmatter to `llms.txt` and extend the gate glob (or soften the rule to exempt non-`.md` entry files). _SoT: the convention + the CI check._

**[G5] Frozen design spec contains a verbatim Portuguese quote, breaching the English-only hard rule** — `D` (+F,G) · medium · high · _clarify_
- **Sources:** [hitl-and-qa-design.md:25](docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md:25) ⟷ [CLAUDE.md:66](CLAUDE.md:66) ⟷ [llms.txt:40](llms.txt:40)
- **Conflict:** Hard rule = English-only for docs; the frozen spec embeds a Portuguese mandate. The `frozen` + lint-ignore exemptions do not suspend English-only. **Authoritative: the hard rule; the frozen-doc exemption is the open question.**
- **Resolution:** Carve an explicit exception (frozen archival specs may quote source verbatim) or add a bracketed English translation — do not silently edit a frozen doc. _SoT: CLAUDE.md:66._

**[G6] `.markdownlintignore` lists seven plan entries that match no existing file (drifted single-source)** — `D` (+C,G) · medium · high · _delete_
- **Sources:** [.markdownlintignore:9-17](.markdownlintignore:9) ⟷ [docs-ci.yml:28](.github/workflows/docs-ci.yml:28)
- **Conflict:** docs-ci declares `.markdownlintignore` the single source of truth for ignores; seven listed plan paths match no git-tracked file (renamed/archived/never committed). The list drifted from the tree it mirrors. **Authoritative: the tree.**
- **Resolution:** Delete the seven stale entries; add a CI assertion that every non-glob ignore path resolves to a tracked file. _SoT: `.markdownlintignore` mirroring the tree._

### Low

**[A3b] code-review skill `api-envelope.md` draws an inaccurate envelope (`{data,error,meta}` — invents `meta`, drops `ok`/`trace_id`)** — `A` · low · high · _clarify_
- **Sources:** [api-envelope.md:7-13](.claude/skills/code-review/references/api-envelope.md:7) ⟷ [common.py:79-92,68-76](backend/app/schemas/common.py:79)
- **Conflict:** Real `ApiResponse` = `{ok,data,error:{code,message,details},trace_id}` — no `meta`. The error sub-shape is correct; the surrounding sketch is wrong. **Authoritative: common.py.** → Fix the sketch.

**[A4] `test-strategy.md` hard-codes "488 passed / 31 skipped", but newer ADR-0009 records 1860 passed** — `B` (+A) · low · high · _clarify_
- **Sources:** [test-strategy.md:224](docs/reference/test-strategy.md:224) ⟷ [0009:115](docs/adr/0009-extraction-finalize-completeness-gate.md:115)
- **Conflict:** ~3.8× difference; a count in a "reference" doc invites agents to treat a small number as the suite size. (Sourcing note: the `:44` diagram cite was not reproduced by grep; the `:224` table cite holds.) **Authoritative: most recent run.** → Replace with non-numeric phrasing; bump `last_reviewed`.

**[A5b] Status spelling drift: `in-progress` (hyphen) breaks the `in_progress` enum value in one spec** — `A` (+C,F,G) · low · high · _clarify_
- **Sources:** [docs/README.md:70](docs/README.md:70) ⟷ [test-infra-hardening-design.md:2](docs/superpowers/specs/2026-05-24-test-infra-hardening-design.md:2)
- **Conflict:** Canonical token + every sibling use underscore; one spec uses the hyphen (and a separate body "Draft" banner). docs-ci never validates the value. **Authoritative: enum + sibling spelling.** → Normalize; enforce via the A5 value-check.

**[B11] run-user-facing-vocabulary plan still `draft` though shipped (#188/#320)** — `B` · low · high · _re-status_
- **Sources:** [plan:2](docs/superpowers/plans/2026-05-30-run-user-facing-vocabulary.md:2) ⟷ git `8e1ab09` (#188), `0e6c914` (#320) ⟷ `frontend/test/copy-run-vocabulary.test.ts`
- **Conflict:** Copy fix + regression guard shipped. **Authoritative: git + guard test.** → Re-status `shipped`/archive.

**[B13] integration-test-pollution-cleanup plan still `in_progress` though #137/#141 merged (likely superseded by SAVEPOINT work)** — `B` · low · **medium** · _re-status_
- **Sources:** [plan:2](docs/superpowers/plans/2026-05-24-integration-test-pollution-cleanup.md:2) ⟷ git `84b68cc`/`697ca6b` (#137/#141) ⟷ `backend/tests/conftest.py:132`
- **Conflict:** Follow-up to merged PRs; the SAVEPOINT `db_session` work (B12) structurally removes that pollution class. **Medium: did not run the suite to confirm the residual is resolved.** → Verify, then re-status `shipped`/superseded, else refresh `last_reviewed`.

**[E2] `CLAUDE.md` "Current focus" likely exceeds its own "≤ 5 lines" budget** — `B` (+E) · low · **low** · _clarify_
- **Sources:** [CLAUDE.md:11-16](CLAUDE.md:11)
- **Conflict:** Section sets a ≤5-line budget yet wraps to ~6 source lines. **Low: "lines" is ambiguous (bullets vs wrapped source).** → Resolves if B1 collapses it to a one-line pointer; otherwise restate the budget as a bullet-count.

**[E5] Memory `reference_api_error_envelope` duplicates the contract already owned by constitution.md, ADR-0008, and the auto-loaded `.claude/rules/backend.md`** — `E` · low · high · _delete_
- **Sources:** memory `reference_api_error_envelope:10-28` ⟷ [constitution.md:141](docs/reference/constitution.md:141) ⟷ [0008](docs/adr/0008-typed-response-payloads.md) ⟷ `.claude/rules/backend.md`
- **Conflict:** A redundant fourth copy of the envelope rule (the backend rule auto-loads on backend edits). **Authoritative: repo docs.** → Shrink to a one-line pointer.

**[F3] Frozen HITL spec references deleted `docs/unified-evaluation-clean-slate.md` as a live guide in 4 places** — `F` · low · high · _clarify_
- **Sources:** [hitl-and-qa-design.md:23,213,341,419](docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md:23) ⟷ `ls` → none
- **Conflict:** Cites a file that does not exist anywhere; the rationale cannot be retrieved. **Authoritative: extraction-hitl-architecture.md (current state).** → Add an editor's note; do not recreate the file.

**[F6] Four standalone design specs have zero inbound references from the active doc surface (orphans)** — `F` · low · **low** · _relocate_
- **Sources:** sidebar-revitalization / dark-light-tokenization / preflight / screening-and-imports design specs ⟷ [docs/README.md:52](docs/README.md:52)
- **Conflict:** Reachable only via the generic dir link; three are `shipped`, one (`screening-and-imports`) is `in_progress` but unbacked by an active plan. **Low: directory-level discoverability ≠ unreachable; non-exhaustive backlink grep.** → Archive the three shipped orphans; re-status/link screening-and-imports.

**[G3] `owner` frontmatter format inconsistent: one plan uses bare `raphaelfh`, every other doc uses `@raphaelfh`** — `D` (+G) · low · high · _clarify_
- **Sources:** [dev-workflow-sota.md:4](docs/superpowers/plans/2026-06-10-dev-workflow-sota.md:4) ⟷ [ROADMAP.md:4](docs/ROADMAP.md:4) ⟷ `check-frontmatter.sh`
- **Conflict:** Gate checks key presence, not format; one file breaks the de-facto `@`-handle convention. **Authoritative: de-facto convention.** → Normalize; optionally pin format in the check.

**[G7] Three active plans carry frontmatter but lack the conventional `.markdownlintignore` entry** — `D` (+G) · low · **low** · _single-source_
- **Sources:** e2e-fixture / linear-integration / run-user-facing-vocabulary plans ⟷ [.markdownlintignore:8](.markdownlintignore:8)
- **Conflict:** Per the memory-sourced plan-doc convention, three tracked plans have neither explicit entry nor glob coverage. **Low: a memory norm, not a hard gate — may be intentional.** → If the convention holds, add the three (or a `plans/*.md` glob); else update the memory.

## 5. Spec-ready cleanup backlog (6 workstreams)

> Effort: S ≈ ½ day, M ≈ 1–2 days. Each maps 1:1 onto the findings above
> (no orphan findings; no unsupported workstream).

### WS-1 — Re-ratify constitution & reference docs against CI (S)
- **Resolves:** A1, A1b, A2, A2c, A3b, A4
- **Scope:** Fix reference docs whose hard facts contradict live gates/config:
  `constitution.md:187` (70→62) + repoint the 5-job list to ci.yml;
  `deployment.md:113` → Feedback-team UUID; `deployment.md:104` → live origin;
  correct `api-envelope.md`; de-numericize `test-strategy.md`.
- **Payoff:** The non-negotiable constitution stops self-contradicting; the
  single highest-risk prod misconfig (feedback misroute) is removed; deploy/
  constitution/skill refs match the live gates.
- **Risk:** A2c is medium-confidence — confirm live Railway `CORS_ORIGINS`
  before editing. **SoT after:** ci.yml + Railway env + `common.py`.

### WS-2 — Fix the frontend error-envelope violation (S)
- **Resolves:** A3
- **Scope:** Replace the four `errorData.detail` reads in
  `apiKeysService.ts` with `errorData.error?.message` (or route through the
  typed client); keep a 4xx test asserting `error.message` surfaces.
- **Payoff:** Removes the only live code path that masks server errors and
  contradicts the documented rule. **Risk:** low (behaviour-preserving).

### WS-3 — Define & enforce one canonical doc status vocabulary (M)
- **Resolves:** A5, A5b, G3
- **Scope:** Re-author `docs/README.md:70` into per-layer subsets (reference/
  how-to; ADR-MADR citing 0001:28; plan/spec), prune dead `deprecated`,
  normalize the lone `in-progress` hyphen, add a status-VALUE + owner-format
  check to `check-frontmatter.sh`, reconcile the memory status list.
- **Payoff:** One *enforced* taxonomy; agent status string-matching becomes
  reliable; the enum can no longer silently drift from the files it governs.
- **Risk:** stage the enum widening first, then flip the CI check to fail.

### WS-4 — Re-status / archive shipped plans & specs + fix the ADR pointer (M)
- **Resolves:** B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, E2, F5
- **Scope:** Flip every plan/spec whose work is in HEAD to `shipped` (or move
  to `plans/archive/`); reconcile the two-line status mismatch in
  test-infra-hardening; verify-then-status the two medium-confidence items (B2,
  B13); replace the `ADR-00XX` placeholder with ADR-0010; update CLAUDE.md
  "Current focus" + ROADMAP "Current cycle" to mark consolidation shipped and
  point at active parsing work.
- **Payoff:** git stops being contradicted by ~13 plan statuses; the first file
  an agent reads names genuinely-active work.
- **Risk:** B2/B13 attribution needs a PR-body check / suite run before
  closing genuinely-open follow-ups. **SoT after:** git/HEAD + docs/adr.

### WS-5 — Collapse duplicated root indices & dual-maintained status/date (M)
- **Resolves:** D1, D2, D4, D6, F6, G6, G7
- **Scope:** Make CLAUDE.md the single source for stack + hard rules and
  docs/README.md the single source for the doc index; reduce llms.txt + README
  to one-line pointers (+ a curated must-read set); drop/generate the visible
  "Last reviewed" line and fix the two drifted bodies; stop labelling whole
  dirs "Active"; relocate `observability-extraction.md` to reference/ and fix
  its two-H1 split; delete the seven dead `.markdownlintignore` entries (+CI
  assertion); reconcile the three missing plan entries; archive the orphan
  specs.
- **Payoff:** stack/convention/index changes touch one file instead of 3–4;
  dates and directory-lifecycle stop drifting; the ignore list mirrors the tree.
- **Risk:** reducing llms.txt/README slightly lowers standalone redundancy —
  keep the curated extraction must-read set; human-review, do not auto-merge.

### WS-6 — Repair dead doc pointers & reconcile memory↔doc ownership (M)
- **Resolves:** F1, F2, F3, F4, G4, G5, E4, E5, E6
- **Scope:** Repoint the four `../../architecture/…` links to `../../reference/`;
  add editor's notes for the dead `docs/planos/ROADMAP.md` and
  `docs/unified-evaluation-clean-slate.md` citations; carve the English-only
  exception for the frozen Portuguese quote; name `test-strategy.md` in the e2e
  plan; add frontmatter to llms.txt + extend the gate glob; trim the
  railway/api-envelope/hitl-inert memories to durable nuggets that link to
  canonical docs, fix the dead `docs/architecture/deployment.md` pointer (+ 4
  more dead memory pointers below), update the half-stale "ONLY finalize gate"
  line and the arch-doc ConsensusRule "drives" overstatement.
- **Payoff:** agents following invariant/testing links hit real files; memory
  stops being a stale fourth copy of contracts the repo already owns; the
  consensus glossary stops implying a quorum gate that does not exist.
- **Risk:** frozen specs are do-not-edit — prefer editor's notes; memory is
  user-owned — propose, do not silently overwrite.

## 6. Proposed spec (for human ratification)

**Goal.** Make the agent-facing corpus self-consistent with code/CI/git and
cheaper to maintain: each governance fact lives in exactly one authoritative
place, lifecycle status tracks reality, and the conventions the corpus declares
are CI-enforced rather than narrated.

**Non-goals.** (1) No behavioural code change beyond the single A3 envelope fix
(WS-2). (2) No rewrite of frozen archival specs — corrections land as editor's
notes. (3) No new doc tooling beyond two small `check-frontmatter.sh` additions
+ one `.markdownlintignore` assertion. (4) Memory edits are *proposed*, not
force-applied (user-owned store).

**Decisions to ratify (open questions in §7).** D1: single-source split
(CLAUDE.md = rules, docs/README.md = index). D2: per-layer status taxonomy +
CI value-check. D3: re-status vs archive policy for shipped plans. D4: the
frozen-doc English-only exception.

**Acceptance criteria.**
- `constitution.md`, `deployment.md`, `api-envelope.md`, `test-strategy.md`
  contain no value that contradicts ci.yml / live Railway env / `common.py`.
- `apiKeysService.ts` reads `error.message`; a 4xx test asserts it.
- `check-frontmatter.sh` rejects an out-of-enum status value and a non-`@`
  owner; every in-scope doc passes.
- No plan/spec whose PR is in HEAD remains `draft`/`in_progress`/`approved`/
  `ready`/`proposed`; CLAUDE.md "Current focus" points only at unmerged work.
- `grep -r 'docs/architecture/\|docs/planos/\|unified-evaluation-clean-slate\|
  docs/reference/tests.md\|ADR-00XX'` over the in-scope tree returns nothing
  live (only editor's-note context).
- `.markdownlintignore` non-glob entries all resolve to tracked files (CI-asserted).

**Sequencing.** WS-1 + WS-2 first (highest agent-impact, smallest, independent)
→ WS-4 (mechanical, high-volume) → WS-3 (enum, gated rollout) → WS-5 + WS-6
(structural, human-reviewed). WS-3's CI check must land *after* WS-4 normalizes
the bulk of statuses.

## 7. Open questions for human ratification

> **RATIFIED 2026-06-20 (all toward the SOTA option):** Q1 → **archive** shipped
> plans/specs out of the agent read-path (keep ADRs on MADR); Q2 → **stop
> documenting env values**, document the contract + add a boot-time env check;
> Q3 → **no legacy** — extract rationale to `docs/explanation/`, archive the
> historical spec, repoint CLAUDE.md to the canonical reference doc; Q4 → add
> `llms.txt` frontmatter + widen the gate; Q5 → **done** (memory consolidation
> applied 2026-06-20). Original questions retained below for provenance.

1. **Status taxonomy shape (WS-3):** ratify the three-lifecycle model (ADR-MADR
   / plan-spec / reference) and the exact allowed value set per layer; confirm
   `deprecated` may be pruned. Should `shipped` plans be *re-statused in place*
   or *moved to `plans/archive/`* (WS-4)? This changes whether the index lists
   them.
2. **A2c (CORS):** is `deployment.md:104` doc-drift, or does the live Railway
   `CORS_ORIGINS` genuinely lack `prumoai.vercel.app` (a real prod issue)?
   Needs a Railway env read before WS-1 edits.
3. **Frozen-doc policy (G5/F2/F3):** ratify an explicit "frozen archival specs
   may quote source verbatim / carry historical pointers via editor's note"
   exception to the English-only + dead-link rules.
4. **llms.txt frontmatter (G4):** add frontmatter + widen the gate glob, or
   formally exempt non-`.md` entry files?
5. **Memory ownership (WS-6):** confirm the agent may trim/repoint the
   user-owned memory store, or should these land as proposals only?

## Appendix A — Ground-truth verdict ledger (selected)

**Confirmed contradictions** beyond those promoted to findings are folded into
A1/A1b/A2/A3/A5/B-cluster/E6 above. **Confirmed clean (no finding):**

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Coverage ratchet 62/80/85 | matches CI | constitution.md:160 ↔ ci.yml:245/279/302 |
| mypy advisory (non-blocking) | matches | ci.yml:58 (`\|\| true`) |
| FE typecheck blocking | matches | ci.yml:464-470 (`tsc --noEmit`) |
| Migration-boundary CI script | exists + wired | ci.yml:155-157 |
| Startup migration gate | exists | `main.py:38,81` |
| Backend envelope emits `error.message` | matches | `error_handler.py:207-243` |
| Typed FE client reads `error.message` | matches | `client.ts:165-180` |
| ADR supersession chains | all resolve | 14 ADRs, no broken `Superseded by` |
| `ROADMAP.md` + docs/README index targets | all exist | (deterministic check) |
| Divergence FE-only; one user can finalize | matches memory | `useReviewerSummary.ts` / `run_lifecycle_service.py:214-246` |

**Governance gap (no doc claim to contradict, worth noting):** vitest coverage
thresholds (70) are configured (`vitest.config.ts:54-61`) but **not enforced**
— CI runs `vitest run` without `--coverage` (`ci.yml:501`).

## Appendix B — Deterministic census (hand-run, read-only)

**Status values, in-scope frontmatter (archives excluded), 2026-06-20:**
14 distinct = `accepted`(11 ADRs), `proposed`(3), `template`(1), `approved`(4),
`draft`(many), `in_progress`(5), `in-progress`(1), `implemented`(2),
`completed`(1), `planned`(2), `ready`(1), `shipped`, `stable`, `frozen`.
Declared enum = 6 (`stable·draft·deprecated·shipped·frozen·in_progress`);
**9 out-of-enum** across **~26 files**; `deprecated` **declared but unused**.

**Memory dead doc pointers (5):**
`docs/architecture/deployment.md` (renamed → `docs/reference/deployment.md`;
`reference_railway_deploys_from_main:100`); `…/plans/2026-06-08-autosave-no-rerecord.md`
and `…/plans/2026-06-08-shared-article-values-hook.md` (moved to `archive/`);
`…/plans/2026-06-19-extraction-view-ux-p0.md` and
`…/specs/2026-06-19-extraction-view-ux-design.md` (branch-local, unmerged —
`project_extraction_view_ux_redesign`). `MEMORY.md` index parity is clean (35 = 35).

**Minor structural note (not a finding):** `docs/explanation/` and
`docs/tutorials/` contain only `.gitkeep`; `docs/README.md` already labels
tutorials "None yet" and maps explanation to the ADR index, so the empty
quadrants are acknowledged placeholders, not drift.

---

*Produced by a read-only governance audit (109 files, 33 ground-truth verdicts,
41 findings, completeness-critic-verified). Next: `/writing-plans` turns this
backlog into an executable, checkpointed implementation plan.*

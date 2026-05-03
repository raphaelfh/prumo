# Design: Screening Workflow + Imports (Greenfield, Modular, AI-Ready)

**Date:** 2026-05-03
**Branch:** `fork/fabianofilho/dev` (designed against `dev` post-DB-refactor)
**Phases covered:** Phase α (v1) — solid human-only screening + imports. AI capabilities (β–ζ) hooked but deferred to roadmap.
**Supersedes:** PR #7 ("bora meu gerente") — full re-architecture; preserves only frontend UI sketches.

## 1. Context

Prumo currently lacks a screening stage. Articles are imported (Zotero, RIS, manual) and proceed directly to extraction / quality assessment. There is no inclusion/exclusion workflow, no PRISMA flow tracking, no dual-review consensus for screening decisions.

PR #7 attempted screening + CSV import + PDF AI metadata extraction in a single 5,228-line change. It was authored before the database refactor that landed migrations `0007–0010` and added `article_author`, `extraction_versioning`, `extraction_workflow`, `integration`, `user`, `user_api_key` models. It also had several material bugs (denormalized `screening_phase` semantics broken, conflict logic non-deterministic and racy, no rollback on exception, frontend bypassed the API to query Supabase directly, CSV preview parser breaks on standard escapes, cascade delete on `ai_suggestions` would corrupt extraction data).

The codebase already has battle-tested HITL/consensus infrastructure for extraction (`HitlConfigService` with `reviewer_count`/`consensus_rule`/`arbitrator_id`, `ExtractionConsensusService` with append-only optimistic-concurrency writes, `ExtractionReviewerDecision → ExtractionConsensusDecision → ExtractionPublishedState` pattern, `ProjectMember` with role enum). It also has a clear design system (`docs/superpowers/design-system/sidebar-and-panels.md`) with Linear-aligned conventions: `⌘K` reserved for command palette, `G+letter` navigation, `KbdBadge` always visible, `useKeyboardShortcuts` shared hook, resizable panels with snap-collapse, persistence via localStorage.

## 2. Decision

**Greenfield, modular, fully optional screening module.** New `screening_*` tables, new services, no extraction/QA dependencies. Screening can be entirely disabled per project — articles flow imported → extraction without any screening artifacts. AI capabilities (single-article verdict, active-learning prioritization, stop criteria, embeddings) are **deferred to the roadmap** but architectural seams are present in v1 so they plug in without schema changes.

Screening's consensus mechanic is similar to extraction's but **does not share tables** with it (per the modularity mandate). The patterns are mirrored, not the rows.

Imports are an **orthogonal module** (`/imports/*`), independent of screening. Screening can be off and imports still work; imports already work and screening adds enrollment on top.

## 3. Foundational decisions (locked in brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | **Greenfield screening module** (no shared rows with extraction) | Modularity: projects can disable screening entirely; users can import curated sets and skip to extraction without dragging screening through the codebase. |
| Reviewer model | **Per-phase HITL config**, mirroring `ExtractionHitlConfig` shape but with own table (`screening_phase_config`) | Common Cochrane pattern: solo TA, dual FT. Per-phase flexibility without forcing extraction's settings on screening. |
| AI in v1 | **Deferred to roadmap** (Phases β-γ) | User pivot: focus v1 on a fluid human review loop. Architectural seams left in v1 so AI lands as an additive module. |
| Active learning in v1 | **Deferred to roadmap** (Phase γ) | Same. `current_priority` column exists, no-op stub service. |
| Imports in v1 | **CSV (Scopus / WoS), PubMed query, RIS, PDF (manual metadata), Zotero (existing)** | Covers ~95% of SR import needs. PDF AI extraction deferred to roadmap with the rest of AI. |
| Auto full-text retrieval | **Unpaywall integration in v1** (pure HTTP, no AI) | Cheap, public API, big UX win at FT phase. |
| Dedup at import | **Strict by DOI + fuzzy `(title, first_author, year)` ≥0.9 → review panel; ≥0.95 → auto-merge** | Covidence-style; PR #7 only had DOI dedup. |
| `screening_consensus` and `screening_published_state` | **Merged into one `screening_outcome` table** | One assignment → at most one consensus → one published state, always together. Lean. |
| Articles status | **Single `articles.screening_status varchar(32) NULL`** with `'pre_included'` value for skip-screening; updated by trigger on `screening_outcome` insert/update | Replaces PR #7's broken denormalized `screening_phase` + `screening_skipped` boolean. Single source of truth, atomic. |
| `screening_assignment.status` enum | **Not stored — derived** from outcome existence + decision count vs reviewer count | Avoids redundant write on every decision. |
| Audit trails | **`version` columns + append-only `screening_outcome`** (no separate audit table) | Existing patterns; satisfies reproducibility need. |
| Notes | **Promoted v2 → v1** (`screening_note` table with threading) | Multi-reviewer collaboration is core, not aux; Rayyan-style |
| Multi-view (Kanban / Spreadsheet) | **Not in v1** | User decision: queue-driven screening doesn't benefit from kanban; bulk operations covered by `⌘K` palette + multi-select in list. |
| Decision panel | **4 buttons** — Include / Exclude / Exclude w/ reason / Maybe (`1`/`2`/`e`/`3`) | First-class "exclude with reason" addresses Cochrane workflow + audit clarity. |
| Reason picker | **Inline popover** (not modal) with recently-used + numbered shortcuts | Sub-2-keystroke exclusion-with-reason. |
| Custom labels | **Per-user keyboard bindings** (`screening_user_preference` table) | Different reviewers want different mnemonics. |
| Smart filters | **v1 = frequency-based keyword extraction** (TF-IDF style) on decided articles, two columns (include / exclude indicators) | Roadmap upgrades to embeddings (β) and LLM-suggested clusters (γ). No AI dep in v1. |
| 2026 patterns adopted in v1 | `⌘K` command palette · inline edit · auto-save · URL = state · KbdBadges always visible · subtle motion · density · dark mode parity · file drag-drop | Already aligned with the project's design system (Linear-style). |

## 4. Data model

### 4.1 New enums (Supabase migration)

```sql
CREATE TYPE screening_phase AS ENUM ('title_abstract', 'full_text');
CREATE TYPE screening_decision AS ENUM ('include', 'exclude', 'maybe');
CREATE TYPE screening_status AS ENUM (
  'pre_included',
  'ta_pending', 'ta_included', 'ta_excluded', 'ta_maybe',
  'ft_pending', 'ft_included', 'ft_excluded', 'ft_maybe',
  'final_included', 'final_excluded'
);
CREATE TYPE screening_consensus_rule AS ENUM ('unanimous', 'majority', 'arbitrated');
CREATE TYPE screening_outcome_source AS ENUM (
  'solo', 'consensus_unanimous', 'consensus_majority', 'arbitrated'
);
CREATE TYPE screening_arbitration_mode AS ENUM ('select_existing', 'manual_override');
CREATE TYPE screening_run_kind AS ENUM (
  'import_csv', 'import_ris', 'import_pubmed', 'import_pdf',
  'unpaywall_fetch', 'smart_filter_refresh',
  -- reserved for AI/AL phases (no row written in v1):
  'ai_screen_single', 'ai_screen_batch', 'priority_retrain'
);
CREATE TYPE screening_run_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'cancelled'
);
```

### 4.2 New tables (Alembic migration `0011_add_screening.py`)

```sql
-- Per-phase configuration. Presence of a row enables that phase for the project.
CREATE TABLE screening_phase_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase screening_phase NOT NULL,
  reviewer_count INT NOT NULL DEFAULT 1 CHECK (reviewer_count BETWEEN 1 AND 5),
  consensus_rule screening_consensus_rule NOT NULL DEFAULT 'unanimous',
  arbitrator_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  blind_mode BOOLEAN NOT NULL DEFAULT false,
  require_exclusion_reason BOOLEAN NOT NULL,
  -- AI seams (v1: defaults off, no UI)
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_model VARCHAR(64) NULL,
  ai_system_instruction TEXT NULL,
  active_learning_enabled BOOLEAN NOT NULL DEFAULT false,
  -- UX
  highlight_terms JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {term: hex_color}
  pico_summary JSONB NULL,                              -- {population, intervention, comparator, outcome}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  UNIQUE (project_id, phase)
);

-- Default require_exclusion_reason: false at TA, true at FT
-- Set in service layer when creating a config; not DB-enforced (config is editable).

CREATE TABLE screening_criterion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase screening_phase NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('inclusion', 'exclusion')),
  label VARCHAR(200) NOT NULL,
  description TEXT NULL,
  ordinal INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT
);
CREATE INDEX idx_screening_criterion_project_phase ON screening_criterion(project_id, phase, ordinal)
  WHERE is_active;

CREATE TABLE screening_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  phase screening_phase NOT NULL,
  current_priority NUMERIC NULL,           -- AL score (v1: always NULL)
  priority_model_version VARCHAR(64) NULL, -- v1: always NULL
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, article_id, phase)
);
CREATE INDEX idx_screening_assignment_priority
  ON screening_assignment(project_id, phase, current_priority DESC NULLS LAST);

CREATE TABLE screening_decision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES screening_assignment(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  decision screening_decision NOT NULL,
  exclusion_reason_id UUID NULL REFERENCES screening_criterion(id) ON DELETE SET NULL,
  rationale TEXT NULL,
  criteria_responses JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {criterion_id: bool|null}
  decision_labels TEXT[] NULL,
  -- AI seams (v1: always false / NULL)
  is_ai_assisted BOOLEAN NOT NULL DEFAULT false,
  ai_suggestion_id UUID NULL REFERENCES ai_suggestions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,                   -- optimistic concurrency
  UNIQUE (assignment_id, reviewer_id)
);
CREATE INDEX idx_screening_decision_assignment ON screening_decision(assignment_id, created_at);
CREATE INDEX idx_screening_decision_reviewer ON screening_decision(reviewer_id, created_at);

-- Merged consensus + published state.
CREATE TABLE screening_outcome (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL UNIQUE REFERENCES screening_assignment(id) ON DELETE CASCADE,
  decision screening_decision NOT NULL,
  exclusion_reason_id UUID NULL REFERENCES screening_criterion(id) ON DELETE SET NULL,
  source screening_outcome_source NOT NULL,
  -- Set when source = 'arbitrated':
  arbitrator_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  arbitration_mode screening_arbitration_mode NULL,
  selected_decision_id UUID NULL REFERENCES screening_decision(id) ON DELETE SET NULL,
  rationale TEXT NULL,
  -- Common
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE TABLE screening_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase screening_phase NULL,
  kind screening_run_kind NOT NULL,
  status screening_run_status NOT NULL DEFAULT 'pending',
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(64) NULL UNIQUE,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_screening_run_project_kind ON screening_run(project_id, kind, created_at DESC);

CREATE TABLE screening_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  parent_id UUID NULL REFERENCES screening_note(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'screening',  -- 'screening'|'title_abstract'|'full_text'|'any'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_screening_note_article ON screening_note(article_id, created_at);

CREATE TABLE screening_user_preference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  label_shortcuts JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"b":"Background","r":"RCT only"}
  reason_shortcuts JSONB NOT NULL DEFAULT '{}'::jsonb,  -- (future) {"1":"<criterion-uuid>"}
  ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

-- Cross-cutting: AI cost tracking (used by extraction + future screening AI).
-- Adding now to avoid a second migration when AI lands.
CREATE TABLE ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  service VARCHAR(32) NOT NULL,    -- 'screening' | 'extraction' | 'import'
  operation VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  cost_usd_micros BIGINT NOT NULL,
  run_id UUID NULL,
  idempotency_key VARCHAR(64) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_project_created ON ai_usage_log(project_id, created_at DESC);
```

### 4.3 Changes to existing tables

```sql
ALTER TABLE articles
  ADD COLUMN screening_status screening_status NULL;
-- NULL = not enrolled (screening disabled or article not yet enrolled)
-- 'pre_included' = bulk-marked at import to skip screening
-- All other values = derived from screening_outcome via trigger

CREATE INDEX idx_articles_screening_status
  ON articles(project_id, screening_status);
```

### 4.4 Trigger — single source of truth for `articles.screening_status`

```sql
CREATE OR REPLACE FUNCTION sync_article_screening_status() RETURNS trigger AS $$
DECLARE
  v_phase screening_phase;
  v_article_id UUID;
  v_other_phase_outcome screening_decision;
BEGIN
  SELECT a.phase, a.article_id INTO v_phase, v_article_id
  FROM screening_assignment a WHERE a.id = NEW.assignment_id;

  -- Compute final status. final_included requires include in BOTH phases that exist.
  IF v_phase = 'full_text' THEN
    IF NEW.decision = 'include' THEN
      UPDATE articles SET screening_status = 'final_included' WHERE id = v_article_id;
    ELSIF NEW.decision = 'exclude' THEN
      UPDATE articles SET screening_status = 'ft_excluded' WHERE id = v_article_id;
    ELSE
      UPDATE articles SET screening_status = 'ft_maybe' WHERE id = v_article_id;
    END IF;
  ELSE  -- title_abstract
    IF NEW.decision = 'include' THEN
      UPDATE articles SET screening_status = 'ta_included' WHERE id = v_article_id;
    ELSIF NEW.decision = 'exclude' THEN
      UPDATE articles SET screening_status = 'ta_excluded' WHERE id = v_article_id;
    ELSE
      UPDATE articles SET screening_status = 'ta_maybe' WHERE id = v_article_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_screening_outcome_status
  AFTER INSERT OR UPDATE ON screening_outcome
  FOR EACH ROW EXECUTE FUNCTION sync_article_screening_status();

-- On enrollment, set _pending if not already set:
CREATE OR REPLACE FUNCTION sync_article_enrollment_status() RETURNS trigger AS $$
BEGIN
  UPDATE articles SET screening_status = (NEW.phase || '_pending')::screening_status
   WHERE id = NEW.article_id AND screening_status IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_screening_assignment_enrollment
  AFTER INSERT ON screening_assignment
  FOR EACH ROW EXECUTE FUNCTION sync_article_enrollment_status();
```

### 4.5 "Articles available for extraction" filter

```sql
SELECT * FROM articles
WHERE project_id = :pid
  AND (
    screening_status IS NULL                                   -- screening disabled
    OR screening_status IN ('pre_included', 'final_included')
  );
```

Index `idx_articles_screening_status` covers this.

## 5. Service layer

Following the existing `LoggerMixin` + `*Repository → *Service` pattern. Each service owns one cohesive concern.

| Service | File | Responsibility | Key methods |
|---|---|---|---|
| `ScreeningConfigService` | `backend/app/services/screening_config_service.py` | Phase enable/disable, criteria, AI/AL toggles, highlight terms, PICO | `upsert_phase_config`, `disable_phase`, `upsert_criterion`, `delete_criterion`, `list_criteria`, `update_pico` |
| `ScreeningWorkflowService` | `backend/app/services/screening_workflow_service.py` | Enroll → decide → outcome → advance | `enroll_articles`, `bulk_pre_include`, `submit_decision` (optimistic concurrency), `update_decision`, `arbitrate`, `advance_to_full_text`, `get_queue` (cursor-paginated, blind-mode aware), `get_assignment` |
| `ScreeningAnalyticsService` | `backend/app/services/screening_analytics_service.py` | Read-only: progress, kappa, PRISMA, smart filters | `progress`, `kappa`, `prisma`, `dashboard`, `compute_smart_filters`, `session_stats` |
| `ScreeningPriorityService` | `backend/app/services/screening_priority_service.py` | (v1 stub) AL interface that returns no-op | `embed_article` (stub), `retrain` (stub), `get_priority_for` (returns None), `estimate_recall` (returns None) |
| `ScreeningAIService` | not in v1 | Reserved for Phase β | — |
| `ScreeningNoteService` | `backend/app/services/screening_note_service.py` | Notes CRUD, threading | `create_note`, `list_thread`, `update_note`, `delete_note` |
| `ScreeningUserPreferenceService` | `backend/app/services/screening_user_preference_service.py` | Per-user shortcuts and UI prefs | `get_preferences`, `update_preferences` |
| `ArticleImportService` | `backend/app/services/article_import_service.py` | (orthogonal — `imports/` domain) | `import_csv_scopus`, `import_csv_wos`, `import_pubmed_query`, `import_ris`, `create_from_pdf_metadata`, `fetch_unpaywall_pdf`, `find_fuzzy_duplicates` |

**Patterns enforced everywhere:**

- `try / await db.commit() / except: await db.rollback()` on every endpoint (fixes PR #7 bug #4).
- Optimistic concurrency: `version` column on `screening_decision` and `screening_outcome`. Client sends current version; server uses `WHERE version = :v RETURNING version + 1`. 409 on mismatch.
- Idempotency keys: AI/import endpoints accept `Idempotency-Key` header; persisted on `screening_run.idempotency_key UNIQUE` with 24h TTL.
- Deterministic ordering: every `get_by_*` repo method includes explicit `ORDER BY created_at, id` (fixes PR #7 bug #3).
- Server-enforced blind mode: `get_assignment(blind_for_user_id=X)` strips other reviewers' decisions when `phase_config.blind_mode = true` AND outcome not yet published.

## 6. API surface

All endpoints under `/api/v1/`. All return `ApiResponse` envelope. All require `CurrentUser`.

```
# === Config (project admin / arbitrator) ===
GET    /screening/projects/{project_id}/config
PUT    /screening/projects/{project_id}/phases/{phase}/config
DELETE /screening/projects/{project_id}/phases/{phase}/config        # disable phase
PUT    /screening/projects/{project_id}/phases/{phase}/pico
POST   /screening/projects/{project_id}/phases/{phase}/criteria
PATCH  /screening/criteria/{id}
DELETE /screening/criteria/{id}

# === Enrollment ===
POST   /screening/projects/{project_id}/phases/{phase}/enroll        # body: {articleIds?: [...]}
POST   /screening/projects/{project_id}/articles/pre-include         # bulk skip-to-extraction

# === Screening loop ===
GET    /screening/projects/{project_id}/phases/{phase}/queue
       ?sort=chronological|manual&limit=20&cursor=...
       # priority sort accepted but ignored when active_learning_enabled = false
GET    /screening/assignments/{id}                                   # blind-mode aware
POST   /screening/assignments/{id}/decisions                         # submit
PATCH  /screening/decisions/{id}                                     # update own (X-Version header required)
POST   /screening/assignments/{id}/arbitrate                         # arbitrator only
POST   /screening/projects/{project_id}/phases/{phase}/advance       # bulk advance to FT

# === Conflicts ===
GET    /screening/projects/{project_id}/phases/{phase}/conflicts
GET    /screening/projects/{project_id}/conflicts                    # all phases (for arbitrator inbox)

# === Analytics ===
GET    /screening/projects/{project_id}/dashboard
GET    /screening/projects/{project_id}/prisma
GET    /screening/projects/{project_id}/phases/{phase}/progress
GET    /screening/projects/{project_id}/phases/{phase}/kappa
GET    /screening/projects/{project_id}/phases/{phase}/smart-filters # frequency-based
GET    /screening/users/me/session-stats?projectId=...

# === Notes ===
GET    /screening/articles/{id}/notes
POST   /screening/articles/{id}/notes
PATCH  /screening/notes/{id}
DELETE /screening/notes/{id}

# === User preferences ===
GET    /screening/users/me/preferences?projectId=...
PUT    /screening/users/me/preferences

# === Runs (audit) ===
GET    /screening/runs/{id}
GET    /screening/projects/{project_id}/runs?kind=...

# === Imports (orthogonal) ===
POST   /imports/projects/{project_id}/csv                            # multipart, format=scopus|wos
POST   /imports/projects/{project_id}/ris                            # existing flow, surfaced via unified menu
POST   /imports/projects/{project_id}/pubmed                         # body: {query, maxResults}
POST   /imports/projects/{project_id}/pdf                            # multipart + manual metadata in same request
POST   /imports/articles/{id}/fetch-fulltext                         # Unpaywall lookup
POST   /imports/projects/{project_id}/dedup-review                   # confirm/reject fuzzy matches
```

### Rate limits (per user)

| Bucket | Limit | Endpoints |
|---|---|---|
| Reads | 120/min | All `GET` |
| Decisions | 60/min | `POST decisions`, `PATCH decisions`, `arbitrate` |
| Mutations | 30/min | `enroll`, `advance`, `pre-include`, `criteria` CRUD, notes |
| Imports | 5/min | All `/imports/*` writes |
| Full-text fetch | 10/min | `fetch-fulltext` (Unpaywall is courteous-API) |

## 7. Frontend architecture

Aligns with `docs/superpowers/design-system/sidebar-and-panels.md`. Reuses existing `command.tsx`, `useKeyboardShortcuts`, `KbdBadge`, `ResizablePanel`, shadcn primitives. Tokens from the design system are mandatory.

### 7.1 Component tree

```
frontend/components/
├── screening/
│   ├── ScreeningInterface.tsx              # tab orchestrator (Queue / Conflicts / Dashboard / Settings)
│   ├── ScreeningTopToolbar.tsx             # Search · PICO · Criteria · Attach PDFs · Filters · Blind mode
│   ├── PhaseSwitcher.tsx                   # TA ⇄ FT segmented control
│   ├── queue/
│   │   ├── ScreeningQueue.tsx              # 3-column orchestrator
│   │   ├── QueueSidebar.tsx                # left: list + sort + session stats
│   │   ├── QueueListItem.tsx               # per-reviewer status chips inline
│   │   ├── ScreeningCard.tsx               # center: hero
│   │   ├── AbstractWithHighlights.tsx
│   │   ├── TopicTags.tsx
│   │   ├── QuickLabelsBar.tsx              # custom labels with shortcut hints
│   │   ├── CriteriaChecklist.tsx
│   │   ├── DecisionPanel.tsx               # 4 buttons (Include / Exclude / Exclude w/ reason / Maybe)
│   │   ├── ReasonPickerPopover.tsx         # inline, recently-used + numbered shortcuts
│   │   ├── NotesThread.tsx                 # threaded, avatars, hover-reveal actions
│   │   ├── UndoBar.tsx                     # 4s window
│   │   └── FiltersPanel.tsx                # right: smart filters + manual filters + active-filters chips
│   ├── conflicts/
│   │   ├── ConflictsInbox.tsx
│   │   └── ArbitrationPanel.tsx            # side-by-side reviewer columns + arbitrator action
│   ├── dashboard/
│   │   ├── ScreeningDashboard.tsx
│   │   ├── ProgressStats.tsx
│   │   ├── KappaCard.tsx
│   │   └── PRISMAFlow.tsx                  # PRISMA 2020 boxes (flexbox, no chart lib)
│   ├── settings/
│   │   ├── PhaseConfigEditor.tsx
│   │   ├── CriteriaEditor.tsx              # inline edit, no modal
│   │   ├── HighlightTermsEditor.tsx        # term + 12-swatch picker
│   │   ├── PICOEditor.tsx
│   │   └── ShortcutsEditor.tsx             # per-user label shortcuts
│   ├── overlays/
│   │   ├── CriteriaQuickViewSheet.tsx      # opened from toolbar (i)
│   │   └── PICOReferenceSheet.tsx          # opened from toolbar (p)
│   └── shared/
│       ├── StatusBadge.tsx                 # decision/conflict/pending — design system tokens
│       ├── ReviewerChip.tsx                # name + decision color
│       └── DecisionButton.tsx
│
└── imports/
    ├── ImportMenu.tsx                      # unified dropdown
    ├── csv/CSVImportDialog.tsx             # uses papaparse, not hand-rolled
    ├── pdf/PDFImportDialog.tsx             # upload + manual metadata (no AI in v1)
    ├── pubmed/PubMedImportDialog.tsx       # query builder + preview
    ├── ris/RISImportDialog.tsx             # existing
    └── shared/DedupReviewPanel.tsx         # used by all sources for fuzzy-match confirmation
```

### 7.2 Hooks

```
frontend/hooks/screening/
├── useScreeningConfig.ts
├── useScreeningQueue.ts                    # useInfiniteQuery, cursor-paginated, prefetches next 5
├── useScreeningAssignment.ts
├── useScreeningDecision.ts                 # optimistic mutate; queue advances instantly
├── useScreeningArbitration.ts
├── useScreeningDashboard.ts
├── useScreeningSmartFilters.ts
├── useScreeningNotes.ts
├── useScreeningSessionStats.ts
├── useUserPreferences.ts
├── useHighlightTerms.ts                    # memoised regex builder
└── useScreeningKeyboardShortcuts.ts        # composes user-bound + reserved keys via useKeyboardShortcuts

frontend/hooks/imports/
├── useCSVImport.ts
├── usePubMedImport.ts
├── useRISImport.ts
├── usePDFImport.ts
├── useUnpaywallFetch.ts
└── useDedupReview.ts
```

### 7.3 State management

| Concern | Tool |
|---|---|
| Server state | TanStack Query with `onMutate` for optimistic, `onError` rollback |
| URL state (filters, sort, current article, panel collapse) | URL params, reload-safe |
| In-card draft (criteria checks, rationale not yet submitted) | `useReducer` per `assignment.id`, persisted to `sessionStorage`, cleared on submit |
| Highlight regex | `useMemo` keyed on `terms.length + terms.join('|')` |
| Panel widths | `localStorage` per design system `prumo:screening-{panel-id}:{width,collapsed}` |

No Zustand store. Adding one invites stale-state bugs; everything fits TanStack + URL + local.

### 7.4 Layout

The screening view nests **inside the project shell** — it is rendered in the content area to the right of the canonical project sidebar (the existing `MainSidebar` component governed by `docs/superpowers/design-system/sidebar-and-panels.md`). It does NOT replace or hide the project sidebar, and it does NOT introduce its own top-level tabs (Rayyan's pattern); section navigation lives where it always lives — in the project sidebar, grouped as `Project` (Overview, Articles), `Review` (Screening, Full text, Extraction, Assessment), `Outputs` (Export, Activity).

Inside the screening content area: a screening-local toolbar (breadcrumb · phase switcher · `⌘K` · `PICO` · `Criteria` sheet · `Blind mode` toggle) above a 3-column body. Each panel collapses independently; the project sidebar is its own panel governed by the design system at the shell level.

| Panel | Owner | Default | Min | Max | Snap-collapse | Toggle |
|---|---|---:|---:|---:|---:|---|
| Project sidebar | shell (existing `MainSidebar`) | 280 | 240 | 400 | 150 | `⌘B` |
| Queue list (left of content) | screening | 340 | 280 | 480 | 220 | `⌘[` |
| Filters (right of content) | screening | 300 | 260 | 420 | 220 | `⌘]` |
| Article detail / PDF (FT phase, slides over right) | screening | 420 | 320 | 640 | 280 | `⌘\` |

All screening panels wrapped in `<ResizablePanel>`. Width and collapsed state persist via `localStorage` keyed `prumo:screening-{panel-id}:{width,collapsed}`. Cross-tab sync via `storage` event.

Power users routinely collapse the project sidebar (`⌘B`) when deep-focusing on screening; the design must remain readable at any combination of panel collapsed states.

### 7.5 Visual polish (Rayyan-density modernized for 2026)

| Element | Treatment |
|---|---|
| Chip system | Normalized: 20px height, `2px 8px` padding, `10px` radius, `text-[10px]` font, status chips use 7px filled dot + label |
| Tonal palette | Muted backgrounds (`#f0fdf4 / #fef2f2 / #fefce8`), mid-saturation foreground; never harsh full-saturation |
| Accent color discipline | `#3b82f6` blue is the sole "interactive" color; everything else neutral or semantic |
| Cards | Border-only (`border-border/40`), no heavy shadows |
| Typography | Title 16/600, abstract 13/400 leading-1.55, metadata 11/400 muted, micro-labels 10/600 uppercase tracking-wider |
| Row state styling | Active: `bg-muted` + 3px left blue bar; in_conflict: 3px left orange bar; decided: text-muted-foreground/80 |
| Notes thread | Slack/Linear-style — avatar + name + relative time + body, hover-reveal actions |
| Filter chips | Linear-style clearable with × |
| Empty / loading / done states | Explicit copy + next action; never naked spinners |
| Motion | Card transition 150ms ease-out; panel resize 200ms ease-out; respect `prefers-reduced-motion` |
| Density | 13px base, 28px nav rows, 11px metadata, tight 1.55 leading |
| Dark mode | Designed light + dark from start using design system tokens |

### 7.6 `⌘K` command palette

Uses existing `command.tsx` cmdk primitive. Fuzzy-ranks across:

- **Actions** (Advance N to FT, Enroll all, Mark pre-included, Bulk attach PDFs, etc.)
- **Navigation** (`G S` Screening, `G F` Full text, `G C` Conflicts, `G D` Dashboard)
- **Articles** (top 20 by recency / relevance to query)
- **Criteria** (with kind badge)
- **Labels** (with bound shortcut)
- **Recent decisions** (with one-click undo)

Each result shows its own keyboard shortcut on the right (passive learning).

### 7.7 Keyboard map (final)

```
DECISIONS:    1  2  e  3
NAVIGATION:   ← →  G S  G F  G C  G D
PANELS:       ⌘[  ⌘]  ⌘\
GLOBAL:       ⌘K  ⌘E  ⌘P  ⌘,
CONTEXTUAL:   c n l o h u s i ?  Esc
USER-BOUND:   any of: a b d f g i j k m o p q r t v w x y z 4-9 0  (for custom labels)
```

Reserved (cannot be user-bound): `1 2 3 e ← → ↑ ↓ Enter Esc c n l h u s ?`

## 8. Imports

### 8.1 Sources in v1

| Source | Flow | Dedup |
|---|---|---|
| CSV (Scopus) | Upload → server `csv` parser → preview top 10 → fuzzy-dedup review → confirm | DOI strict + fuzzy ≥0.85 |
| CSV (Web of Science) | Same as Scopus, different column mapping | Same |
| PubMed query | Query builder UI → server hits E-utilities `esearch` + `efetch` → preview → confirm | Same |
| RIS | Existing parser, surfaced via unified menu | Same |
| PDF (manual) | Upload + fill metadata form (no AI) → save → PDF attached as `ArticleFile(role='MAIN')` | DOI strict only |
| Manual entry | Existing form | None |
| Zotero sync | Existing — no changes | Existing |

### 8.2 Fuzzy dedup

```python
def normalize_for_match(article):
    title = re.sub(r'[^\w\s]', '', article.title.lower()).strip()
    title = re.sub(r'\s+', ' ', title)
    first_author = (article.authors or [''])[0].split(',')[0].lower().strip()
    year = article.publication_year or 0
    return (title, first_author, year)

def fuzzy_match_score(a, b):
    title_sim = rapidfuzz.fuzz.token_sort_ratio(a.title, b.title) / 100
    author_match = 1.0 if a.first_author == b.first_author else 0.0
    year_match = 1.0 if a.year == b.year else 0.0
    return 0.7 * title_sim + 0.2 * author_match + 0.1 * year_match
```

Thresholds: `≥0.95` auto-merge (counts as duplicate, no UI), `0.85–0.95` shown in `DedupReviewPanel`, `<0.85` import as new. Adjustable per project (config in `screening_phase_config` or new `project.dedup_threshold`).

New dependency: `rapidfuzz` (~50KB, no compile pain).

### 8.3 Unpaywall

- `POST /imports/articles/{id}/fetch-fulltext` — rejects if no DOI
- Calls `https://api.unpaywall.org/v2/{doi}?email={config.unpaywall_email}` (free, courtesy-rate-limited)
- If `best_oa_location.url_for_pdf`: download → Supabase Storage at `{project_id}/{article_id}/unpaywall.pdf` → create `ArticleFile(role='MAIN', source='unpaywall', license=...)`
- Records `screening_run(kind='unpaywall_fetch')` for audit
- Bulk action "Fetch full-text for selected" on articles list — Celery task per article, rate-limited 10/min

### 8.4 What's deferred from imports

- BibTeX, EndNote XML, CSL JSON
- Embase, Cochrane CENTRAL
- DOI lookup with auto-metadata fill (CrossRef API)
- PDF AI metadata extraction (deferred with AI block)
- Library proxy / Sci-Hub (never)

## 9. Screening loop UX

### 9.1 Decision flow (the hot path)

```
Key '1' pressed
  ▼
[t=0]    Mutation triggered, onMutate runs synchronously:
           • queryClient.setQueryData(['queue'], advance one slot)
           • Card slides out (CSS class)
           • UndoBar shown for 4s
[t=16]   Browser paints next frame
[t=200]  Animation done; next card visible
[t=~400] Server responds
           success: silently invalidate ['progress','prisma']
           error: rollback queue + position; toast
[t=4000] UndoBar fades out
```

Multiple keypresses queue (FIFO) and replay in order; never block.

### 9.2 Solo vs Dual

| Aspect | Solo (`reviewer_count = 1`) | Dual (`reviewer_count = 2`) |
|---|---|---|
| Footer chip | "Solo review — your decision is final" | "Dual review — you + Maria García" |
| On submit | Outcome auto-published, `source = 'solo'` | Decision saved; outcome only when partner agrees (`consensus_unanimous`) or arbitrator resolves |
| Both reviewers agree | n/a | Outcome auto-published, toast "consensus reached" |
| Reviewers disagree | n/a | Toast "conflict — sent to arbitrator"; assignment moves to Conflicts inbox |
| Blind mode | n/a | When `phase_config.blind_mode = true`, `get_assignment` strips partner's decision until outcome published |

### 9.3 Conflict resolution

- ConflictsInbox: list of in-conflict assignments, sorted by phase + age. Visible to arbitrator + project admins.
- ArbitrationPanel: side-by-side reviewer columns with diff-highlighted disagreeing criteria; three actions:
  - **Adopt A / Adopt B**: copies that reviewer's decision (incl. exclusion reason) into a new outcome with `source='arbitrated'`, `arbitration_mode='select_existing'`, `selected_decision_id=<reviewer-decision-id>`. Single insert.
  - **Override**: opens decision panel inline; arbitrator submits fresh decision; outcome written with `arbitration_mode='manual_override'`, full rationale required.

### 9.4 Phase advance

`POST /screening/projects/{id}/phases/{phase}/advance`
- Modal: "Advance N included articles to full-text screening?"
- Optional `[ ] Also advance Y "maybe" decisions` (default off)
- Confirm → bulk-creates `screening_assignment(phase='full_text')` for picked articles. Trigger updates `articles.screening_status` to `ft_pending`.
- Phase switcher flips to FT. FT card extension shows inline PDF viewer using existing PDF infrastructure (PR `pdf-viewer-phase*`).

### 9.5 Categorical exclusion reasons

When `phase = full_text + decision = exclude + config.require_exclusion_reason = true`:
- `2` keypress is disabled (tooltip "Reason required at full-text — use [e]"); `e` is the only path.
- `e` opens `ReasonPickerPopover` (inline, not modal) showing recently-used reasons at top, all reasons numbered `1`–`9` for one-keystroke selection. Total keystrokes: `e` + `1` = 2 keys.
- "+ Add new reason" inline creates a new `screening_criterion(kind='exclusion')` without leaving flow.

### 9.6 Empty / loading / error / done states

| Situation | Treatment |
|---|---|
| No phase config | "Screening not configured for this project" + [Configure] (→ Settings) and [Skip — pre-include all articles] |
| Phase config but no enrolled articles | "N imported articles not yet enrolled in {phase}" + [Enroll all] |
| All articles decided in current phase | "All {phase} decisions complete" + summary stats + [Advance N includes to full-text] / [Skip to extraction] |
| Loading queue | Skeleton card preserves layout |
| Network error | Inline retry button on the affected component, never a full-page error |
| Article already decided by user | "You decided this on Mar 4 as Include — [Edit decision]" — explicit |
| Reviewer in conflict | Article disappears from queue, toast "Sent to arbitrator", small chip in dashboard |

## 10. Roadmap

### Phase α — v1 (this spec)
Solid human review foundation. 8 tables. ~32 endpoints. 3-column UI. `⌘K`. Imports + Unpaywall.

### Phase β — v2 (AI copilot)
- AI screening with streamed verdicts (per-criterion verdict + quoted span)
- Per-article AI suggestion (not auto-applied — always reviewer decides)
- AI-suggested filter clusters (replaces frequency-based smart filters)
- PDF AI metadata extraction at import
- Hooks already in v1: `screening_decision.is_ai_assisted`, `screening_decision.ai_suggestion_id`, `screening_run(kind='ai_screen_*')`, `ai_usage_log`

### Phase γ — v3 (active learning)
- pgvector + OpenAI text-embedding-3-small (`article_embedding(article_id, embedding vector(1536), model_version)` — single new table)
- Logistic-regression priority ranking (sklearn)
- Stop-criteria estimator (Wallace recall)
- OpenAI Batch API for overnight bulk
- Hooks already in v1: `screening_assignment.current_priority`, `priority_model_version`, `screening_phase_config.active_learning_enabled`, `screening_run.idempotency_key`

### Phase δ — v4 (living review)
- Living queries — saved PubMed query, weekly auto-fetch, "New since last week" inbox
- Bidirectional Zotero sync — decisions sync back as Zotero tags
- Reproducibility log export — single `.json` audit artifact
- PROSPERO + OSF integration

### Phase ε — v5 (synthesis assistance)
- AI-drafted methods section from PICO + criteria
- AI-drafted results section from final included articles (themes via embedding clusters)
- Citation network view
- Evidence map (clusters by topic / methodology)
- Auto-PRISMA flowchart as live artifact

### Phase ζ — v6 (multi-modal extraction)
- Auto-extract figures from PDFs
- Auto-extract tables → structured data
- Forest-plot suggestions for meta-analyses

## 11. Migration plan

### 11.1 Single Alembic migration

`backend/alembic/versions/0011_add_screening.py`:

- `down_revision = '0010_lock_handle_new_user'` (current head on `dev`)
- Uses `op.create_table()` for all 8 new tables (no raw SQL splitter — fixes PR #7 footgun)
- `op.add_column('articles', sa.Column('screening_status', ...))`
- `op.execute(...)` only for the trigger functions and `CREATE TYPE` enums
- Down migration drops in reverse order

### 11.2 Supabase migration

`supabase/migrations/0004_screening_enums.sql` — `CREATE TYPE` for the 7 new enums. Mirrors the Alembic enum creation; required because Supabase's auth/storage layer doesn't see Alembic state.

### 11.3 Backfill

None. New schema, no production screening data exists. Articles' new `screening_status` column defaults to NULL, which is the correct value for "not enrolled".

### 11.4 Rollout

- Behind a project-level feature flag for the first week (`projects.features.screening_enabled bool DEFAULT false`).
- Pilot with 1–2 internal projects.
- Flag flip after kappa + PRISMA outputs verified against a known reference review.

## 12. Testing strategy

### 12.1 Backend

- **Repositories**: pytest with `pytest-asyncio` + real Postgres (existing pattern). Cover: deterministic ordering, optimistic concurrency rejection, dedup math, fuzzy thresholds, idempotency key reuse.
- **Services**: pytest with mocked dependencies. Cover: solo vs dual outcome creation, blind-mode masking, conflict detection deterministic, advance-to-FT correctness, smart filter math.
- **Endpoints**: pytest with FastAPI test client. Cover: rollback on exception, rate limits, version mismatch (409), auth required, blind-mode response shape.
- **Triggers**: SQL test fixtures verifying `articles.screening_status` updates on outcome insert/update and on enrollment.

### 12.2 Frontend

- **Hooks**: vitest. Cover: optimistic mutate + rollback on error, queue advance, undo within 4s window, draft persistence to sessionStorage.
- **Components**: vitest + Testing Library. Cover: keyboard map (1/2/e/3), criteria checklist toggle, reason picker numbered selection, blind mode hides partner decisions.
- **E2E**: Playwright (existing infra). Cover: enroll → decide → conflict → arbitrate → advance → see PRISMA update; CSV import → fuzzy dedup confirm → article list; Unpaywall fetch attaches PDF.

### 12.3 PR #7 regression cases (must all pass)

- Endpoints rollback on exception (no aborted-transaction leak)
- Conflict detection is deterministic regardless of decision insertion order
- N≥3 reviewers don't break consensus logic
- Concurrent decisions don't double-create conflicts
- `articles.screening_status` semantics match what the trigger emits
- Cascade delete on `screening_run` does NOT cascade to `ai_suggestions` (uses `SET NULL`)
- CSV preview parser handles `""` escaped quotes (use `papaparse`, not hand-rolled)
- CSV import has size guard (rejected when payload >25 MB)

## 13. Performance budgets

| Action | Target |
|---|---|
| Keypress → animation start | <16 ms (1 frame) |
| Card transition | 200 ms ease-out |
| Server roundtrip on decision | p50 <400 ms, p99 <1500 ms |
| First paint of Screening tab | <800 ms (lazy route, single composed dashboard query) |
| Queue scroll/sort change | <150 ms (cursor pagination, prefetch next 5) |
| Smart filter refresh | <500 ms (cached 60s) |
| Unpaywall fetch | <3 s p95 (network-bound) |

## 14. Open questions / known limitations

- **Solo vs team mode UX divergence** — the design supports both via `reviewer_count`, but we haven't user-tested whether solo researchers find the dual-review surface confusing when `reviewer_count = 1`. Mitigation: dual-review surface (Conflicts inbox, blind mode toggle) hidden when `reviewer_count = 1`.
- **Smart filter cold start** — frequency extraction requires ≥10 decisions to produce useful keywords. Below that, panel shows "Smart filters appear after 10 decisions" empty state.
- **Highlight regex performance with large term lists** — memoised regex builder is O(n) terms, but very large lists (>50 terms) may impact render time on long abstracts. Mitigation: cap `highlight_terms` at 30 terms in v1, document.
- **Fuzzy dedup threshold tuning** — defaults are heuristic. v1 ships with a per-project setting; v1.5 may add an "auto-tune" based on user accept/reject rates.
- **Living queries (Phase δ)** — requires a Celery beat schedule and a notification channel. Out of scope for v1 but no v1 design dependency.

## 15. Out of scope (explicit)

- AI screening (any form) — Phase β
- Active learning prioritization — Phase γ
- Stop criteria estimation — Phase γ
- pgvector / embeddings — Phase γ
- AI-drafted methods/results — Phase ε
- Citation network visualization — Phase ε
- Evidence map — Phase ε
- Multi-modal extraction (figures, tables) — Phase ζ
- Supabase Realtime presence ("X is reviewing this") — v2
- Mobile-optimised layout — v2 (responsive enough to function, not optimised)
- Per-reviewer activity log UI — v2 (`screening_decision.created_at` is the audit trail)
- Triage labels beyond Include/Exclude/Maybe — v2 (use decision_labels for finer taxonomy)
- WebOfScience-specific column handling beyond CSV — defer
- BibTeX, EndNote XML, CSL JSON imports — defer
- Library proxy / paywalled fulltext fetch — never (legal)

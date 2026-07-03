---
status: approved
last_reviewed: 2026-07-03
owner: raphael
---

# Review popover slimming + prompt-composition provenance

Design spec agreed on 2026-07-03. Two problems from user feedback on the
extraction review popover (`AISuggestionReviewPopover`):

1. The popover grows too tall, gets clipped by the viewport, and buries the
   decision content (value, rationale, evidence) under audit detail.
2. "Prompt sent" in the provenance disclosure shows only the system prompt.
   The real user prompt (section instruction + full budgeted article
   markdown) is never persisted or shown, the requested fields live in the
   response schema (invisible), and the run-level provenance snapshot is
   overwritten per section (last-write-wins), so per-section attribution is
   impossible today.

## Decisions (brainstorm outcomes)

- **Reading flow**: evidence stays up front in the popover; provenance moves
  one click deeper into a dedicated surface.
- **Container**: centered Dialog ("How this was generated"), not a sheet or
  in-popover tabs.
- **Prompt transparency goal**: explain what the AI saw (structured
  composition), not byte-exact reproducibility.
- **"View text sent"**: expands inside the dialog (lazy-loaded stored
  markdown), no new reader mode.
- **Responsiveness (user addition)**: the popover keeps a stable, bounded
  size at any viewport and any text length — a single internal scroll region
  absorbs growth. Stress-test explicitly at multiple sizes with oversized
  fixtures.

## Non-goals

- Byte-exact prompt reproduction or persisting the rendered article text per
  run (storage duplication rejected).
- Migrating provenance on historical runs (forward-only; legacy shape keeps
  rendering).
- A markdown mode for the PDF reader.
- Quorum/consensus changes — this is a transparency + layout change only.

## 1. Backend — per-section provenance with prompt composition

`SectionExtractionService._build_run_provenance` gains a structured
`prompt_composition` block, and the snapshot becomes **per-section** inside
`run.provenance`:

```jsonc
{
  "sections": {
    "<entity_type_id>": {
      // existing flat fields (model, provider, temperature, output_retries,
      // timeout_seconds, strategy, prompt_name, prompt_version, ran_by_*)
      "tokens_prompt": 23710,          // this section's calls, not run aggregate
      "tokens_completion": 970,
      "tokens_total": 24680,
      "prompt_composition": {
        "section_name": "Source of Data",
        "system_prompt": "You are an expert at extracting…",
        "section_instruction": "Extract the following information…\nSection: Source of Data\nDescription: …\nArticle text:\n[[ARTICLE_MARKDOWN]]\n…",
        "article_ref": {
          "file_id": "<uuid>",
          "file_name": "teste3.pdf",
          "truncated": false          // did build_prompt_input cut blocks?
        },
        "fields_requested": ["data_source"],
        "llm_calls": 1                 // schema splits (len(output_models))
      }
    }
  }
}
```

- `section_instruction` is the real user template rendered with the run's
  actual variables, with the article replaced by the `[[ARTICLE_MARKDOWN]]`
  marker — byte-faithful to that run's template version without duplicating
  the article.
- `article_ref.truncated` comes from `build_prompt_input` (it knows whether
  the token budget dropped blocks). A token estimate is included only when
  the budget path already computes one; absent keys are omitted.
- The quality-assessment path gets the same treatment (its prompt module
  also has a system/user split).
- Aggregate run tokens remain available (sum of sections) wherever the run
  summary needs them; per-suggestion display uses the section's own numbers.

**Read path**: `extraction_suggestion_read_service` resolves a suggestion's
provenance via its instance's `entity_type_id` into `provenance.sections`,
**falling back to the legacy flat shape** when `sections` is absent. No data
migration. The service keeps flattening to camelCase for the frontend.

**Contract**: provenance stays a typed-enough JSON payload on the existing
history response; regenerate `frontend/types/api/schema.d.ts` if any Pydantic
response model changes. The hand-typed `RunProvenance` in
`frontend/types/ai-extraction.ts` gains an optional `promptComposition` shape.

## 2. Frontend — slim popover with a single-scroll responsive contract

`AIPopoverShell` becomes a flex column with a hard viewport bound:

- `PopoverContent`: `max-h-[min(var(--radix-popover-content-available-height),34rem)]`,
  `flex flex-col`; width stays `w-[min(380px,calc(100vw-1.5rem))]`.
- Header and footer: `shrink-0`. Body: `flex-1 min-h-0 overflow-y-auto` —
  the **only** scroll region in the popover. Content growth (long values,
  long rationale, many versions) is absorbed by this scroll; the popover's
  outer size never exceeds the space Radix reports below/above the trigger.
- `VersionRow` (selected): keeps rationale and evidence (decision content).
  The inline `RunProvenanceDisclosure` is replaced by a one-line summary row
  — `{model} · {tokensTotal} tokens` + a "How this was generated" button that
  opens the dialog. The prompt code block leaves the popover entirely (no
  nested scroll remains).
- Long-text hygiene: value keeps `line-clamp-3` + title tooltip; all flex
  children that can truncate carry `min-w-0` + `truncate`/`break-words`.

## 3. Frontend — `GenerationDetailsDialog`

New component under `frontend/components/extraction/ai/` opened from the
summary row (shadcn `Dialog`):

- Size: `w-[min(36rem,calc(100vw-2rem))]`, `max-h-[85dvh]`, flex column;
  header `shrink-0`, body `overflow-y-auto min-h-0`.
- Header: title + context line (section name · run timestamp · ran by).
- Params grid: registry-driven scalar rows (reuses the
  `PROVENANCE_REGISTRY` concept — label/format/order, generic fallback rows
  for unknown keys), responsive `auto-fit` columns (2 → 1 on narrow).
- **Prompt composition recipe** (numbered, in send order):
  1. System prompt — collapsed 2-line preview, expandable in-flow, copy.
  2. Section instruction — code block with the rendered template (marker
     visible where the article goes).
  3. Article chip — file name, ~tokens, truncated notice when applicable;
     expanding it lazy-loads the stored markdown into a bounded
     (`max-h-[40vh]`) scrollable block with copy. This is the one deliberate
     nested scroll, opt-in and inside a large surface.
  4. Requested fields — field-name chips + "split across N calls" note when
     `llm_calls > 1`.
- Token metric row: prompt / completion / total (section-scoped numbers).
- **Legacy fallback**: runs without `prompt_composition` render the current
  scalar rows + the raw `prompt_text` code block inside the dialog.
- `RunProvenanceDisclosure` is deleted once the dialog lands (no legacy
  component left behind).

## 4. "View text sent" data path

Lazy fetch on expand via TanStack Query → service → typed apiClient. No
content-markdown read exists in the API layer today (verified 2026-07-03),
so add
`GET /api/v1/projects/{project_id}/articles/{article_id}/content-markdown`
(project-membership checked, `ApiResponse` envelope, typed response model).
Fetch failure renders an inline error with retry inside the expanded block
(`ErrorResult`, no toast). When `truncated: true`, label the block as "the
run sent a budgeted subset of this text".

## 5. Copy, errors, testing, verification

- All new strings in `frontend/lib/copy/extraction.ts` (English).
- Interleaved tests per layer (never batched at the end):
  - Backend: `extract_section` persists sections-keyed provenance with
    composition (marker present, fields_requested, llm_calls, truncated
    flag); read service resolves per-section and falls back to legacy flat;
    two sections in one run no longer overwrite each other.
  - Vitest: shell exposes the available-height bound and single scroll
    region; popover renders summary row and no code block; dialog renders
    recipe sections; legacy fallback; markdown lazy fetch with MSW (loading,
    success, error+retry). Import engine-free pieces from
    `@/pdf-viewer/core` in unit-tested components (jsdom barrel crash).
- **Responsiveness stress-test** (user requirement): throwaway DEV-only
  harness route (same pattern as the run-header harness) rendering the
  popover + dialog with oversized fixtures — 12+ versions, multi-paragraph
  rationale, unbroken 300-char token, long section names, 23k-token
  markdown. Verify at 360×640, 768×1024, 1280×800, and a short viewport
  (1280×500), light + dark: popover bounding rect never exceeds the
  viewport, no horizontal overflow, footer stays reachable. Bounding-rect
  checks via preview tooling; scroll/observer glue via unit tests (preview
  Chrome lacks IntersectionObserver). Close with the `design-review` loop
  before "done".

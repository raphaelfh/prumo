# PDF Viewer — Phase 4: W3C annotations + Recogito

> **Status:** Pending — schema coordination required.
> **Predecessors:** Phase 2b (TextLayer + search), Phase 3 (Citations API).
> **Successor:** Phase 5 (reader view + a11y + cleanup).

## Why it's blocked

The viewer's *citation* overlay (Phase 3) and the user-authored *annotation*
overlay (this phase) share rendering primitives but have different
provenance, write paths, and lifecycles:

- **Citations** come from extraction evidence (`extraction_evidence`) and
  describe AI/human/review attributions to a specific extraction value.
  Read-only from the viewer's perspective.
- **Annotations** are user-authored markup on the PDF: highlights, boxes,
  notes — independent of any extraction.

The legacy schema has three tables for the second set
(`article_highlights`, `article_boxes`, `article_annotations`,
ORM models added in commit `d2451e6`). The Phase 4 target is to
consolidate them into a single W3C Web Annotation Data Model row in
`pdf_annotations`.

The blocker is that the same schema work is also planned on parallel
worktree `claude/strange-wiles-a189ef` per the requirements spec
(`2026-04-28-pdf-viewer-database-requirements.md` §5). Whichever side
lands first owns the migration; the other rebases. **No code or
migration should be written here until that coordination completes.**

## Open questions (need human decisions)

| # | Question | Recommendation |
|---|---|---|
| 1 | Use Recogito.js (the canonical W3C JS lib) or a thinner in-house overlay? | Recogito.js — battle-tested, supports WADM serialization, works with TextLayer. Wrap it behind a `PDFAnnotationLayer` primitive so we can swap later. |
| 2 | Are annotations per-user or shared per project? | Shared by default (project members see all), with an optional `is_private` boolean for personal scratch annotations. |
| 3 | Migration strategy for the 3 legacy tables — soft-deprecate or backfill into `pdf_annotations`? | Backfill, then drop. Plan 7 in the spec already calls this out. |
| 4 | Anchoring: WADM `TextQuoteSelector` only, or include `FragmentSelector` for page-bbox? | Both — WADM allows multiple selectors per target. Map to `CitationAnchor` shapes (text/region/hybrid) so we can reuse the existing renderer. |
| 5 | Realtime updates (Supabase realtime) — yes or polling? | Polling at 30s for v1; realtime is a follow-up if collaborative editing becomes a requirement. |

## Schema target (per requirements spec §5)

```sql
CREATE TABLE pdf_annotations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_file_id UUID NOT NULL REFERENCES article_files(id) ON DELETE CASCADE,
  creator_id      UUID NOT NULL REFERENCES profiles(id),
  motivation      TEXT NOT NULL,         -- 'highlighting' | 'commenting' | 'tagging' | …
  body            JSONB NOT NULL,        -- WADM Body — see below
  selectors       JSONB NOT NULL,        -- array of WADM Selectors (TextQuoteSelector + FragmentSelector)
  is_private      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pdf_annotations_motivation_valid CHECK (
    motivation IN ('highlighting', 'commenting', 'tagging', 'classifying', 'replying', 'identifying')
  )
);

CREATE INDEX idx_pdf_annotations_file_id ON pdf_annotations(article_file_id);
CREATE INDEX idx_pdf_annotations_creator ON pdf_annotations(creator_id);
```

RLS: project members can SELECT all (modulo `is_private = true AND creator_id <> auth.uid()`); INSERT/UPDATE/DELETE restricted to the creator. Same `is_project_member()` gate as `article_text_blocks`.

## Tasks (in order, once unblocked)

1. **Coordinate** with strange-wiles-a189ef on which worktree owns the migration. Settle the FK direction for `extraction_evidence.pdf_annotation_id` (spec §5 stretch) at the same time.
2. Alembic migration `0007_pdf_annotations` per the schema above + RLS policies (project-member gate + creator-scoped writes).
3. Backfill migration `0008_backfill_legacy_markup`: copy rows from `article_highlights` / `article_boxes` / `article_annotations` into `pdf_annotations` with appropriate `motivation` (`highlighting` / `commenting` / `commenting`) and selectors. Mark legacy tables as deprecated in comments; drop in a later release after consumers migrate.
4. SQLAlchemy model `PdfAnnotation` in `backend/app/models/article.py` next to the consolidated cluster.
5. Pydantic schemas in `backend/app/schemas/annotations.py` mirroring the WADM types ([Body, Target, Selector] discriminated unions).
6. Backend endpoints (CRUD): `GET /api/v1/articles/{id}/annotations`, `POST /api/v1/annotations`, `PATCH /api/v1/annotations/{id}`, `DELETE /api/v1/annotations/{id}`. Membership + creator gates.
7. Frontend: `PDFAnnotationLayer` primitive that wraps Recogito.js. Mount it inside `Viewer.Page` next to TextLayer.
8. Frontend: `useArticleAnnotations(articleId)` TanStack Query hook (mirror `useArticleCitations`) + a `useAnnotationMutations()` for CRUD.
9. Tests: vitest smoke (mount + add highlight + persist), e2e (multi-reviewer: A annotates, B sees it after refresh, C deletes own).

## Verification

- Migration `0007 + 0008` applies cleanly on a freshly-seeded DB; row counts match between legacy tables and `pdf_annotations` post-backfill.
- Annotation API rejects writes to private annotations the caller didn't create (403).
- Frontend: drawing a highlight in the QA page persists, survives reload, and is visible to a second reviewer in real time (or after 30s polling).
- E2E suite remains green; no regression on existing extraction/QA flows.

## Out of scope

- Recogito.js plugins (image regions, table-cell selectors). v1 is text + bbox.
- Threading/replies on annotations — `motivation: 'replying'` is in the enum but the UI for it is a follow-up.
- Anonymized export of annotations — separate plan.

## Coordination checklist before starting

- [ ] Verify which worktree owns the schema migration. Confirm via the repo's parallel-worktree status doc or by checking `claude/strange-wiles-a189ef`'s alembic head.
- [ ] Confirm the WADM body shape (we want `{"type": "TextualBody", "value": "...", "format": "text/plain"}` for comments and `{"type": "TextualBody", "value": "yellow"}` for highlights — agree with strange-wiles before writing migrations).
- [ ] Decide whether `extraction_evidence.pdf_annotation_id` ships now or in a follow-up.
- [ ] Pick Recogito.js vs in-house once an actual screen mockup exists. Recogito's API requires a TextLayer with `data-spans` — confirm our TextLayer is compatible (the v5 pdfjs TextLayer emits `<span>` per text item, which Recogito accepts).

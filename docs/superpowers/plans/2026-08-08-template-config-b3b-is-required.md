---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Template config B-3b — entity `is_required` reaches the progress numbers

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans. Tiny disclosed slice (the B-1 re-slice
> table's B-3b): panel run as ONE consolidated adversarial reviewer —
> proportionate to a ~15-line diff.

**Goal:** The worklist/dashboard progress numbers respect the ACTIVE
snapshot's entity-level `is_required`: a required `cardinality='many'`
section with zero instances stops reading as complete (phantom-slot
logic in `progress.ts` activates); an optional one keeps not blocking.

**Architecture:** B-3a deliberately shipped an INERT legacy projection in
`useActiveTemplateStructure` — the snapshot carries entity-level
`is_required` but the hook strips it so visible numbers wouldn't move in
a re-point-only PR (its own comment names B-3b as the disclosed change).
B-3b deletes the strip: widen `TemplateEntityTypeWithFields` with
`is_required?: boolean` (optional — the LIVE PostgREST hook doesn't
select it and its consumers don't need it) and map it through. The
backend already projects it end-to-end (`RunViewEntityType.is_required`,
`entity_types_for_version`); `computeRowProgress` /
`computeRequiredFieldProgress` already implement the template-driven
phantom-slot semantics and are already tested for them.

## Tasks

### Task 1: Hook projection passes `is_required` (TDD)

**Files:**
- Create: `frontend/test/hooks/useActiveTemplateStructure.test.tsx`
- Modify: `frontend/hooks/extraction/useActiveTemplateStructure.ts`
- Modify: `frontend/hooks/extraction/useTemplateEntityTypes.ts` (type
  only: `is_required?: boolean` on `TemplateEntityTypeWithFields`)

- [ ] RED: test mocks `@/services/templateStructureService` with a tree
  whose entity types carry `is_required: true/false` and asserts the
  hook's `entityTypes` EXPOSE `is_required` (and keep the B-3a
  projection fields). A second case: `computeRowProgress` fed the hook's
  projection with a required zero-instance `cardinality='many'` entity +
  an authoritative instance map returns < 100 (wires the two pieces —
  the phantom-slot unit tests already exist in progress.test).
- [ ] GREEN: map `is_required: et.is_required` in the hook; replace the
  B-3a inertness comment with the B-3b disclosure; widen the interface.
- [ ] `npm run test:run` + `npx tsc -p tsconfig.app.json --noEmit` +
  `npm run lint` green; commit.

### Verify

- Full frontend suite green (progress consumers: ExtractionInterface
  stats, ArticleExtractionTable, HITL list — all read the same
  `computeRowProgress`, so the change is one chokepoint).
- `make quality-scan` green before PR.

## Non-goals

- Threading entity `is_required` into the LIVE `useTemplateEntityTypes`
  PostgREST select (config-grid concern; the grid shows required-ness
  from its own field data; B-5 territory).
- Any backend change (the projection already exists end-to-end).

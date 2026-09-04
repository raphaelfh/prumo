---
status: draft
last_reviewed: 2026-09-04
owner: '@raphaelfh'
---

# Backlog — TRIAGE of the SCAN (confidence ≥ 0.7, deduped by file/line/category)

| # | sev | conf | category | file:line | finding | action |
|---|---|---|---|---|---|---|
| 1 | high | 0.95 | concept-drift | `backend/app/schemas/template_portable.py:90` | the import defaults it to ``"model"`` on a group and leaves it unset elsewhere. | Update the PortableSection docstring: the bundle's noun is kept verbatim, NULL included, a |
| 2 | high | 0.95 | test-gaps | `backend/app/services/entry_group_extraction.py:153` | entry_label = ... or DEFAULT_ENTRY_LABEL feeds the identification prompt; _pinned_group ha | Assert the identification prompt names 'entry' for the NULL-noun group and 'validation' fo |
| 3 | high | 0.9 | concept-drift | `frontend/lib/copy/templateConfig.ts:378` | 'Sections nest only inside a group, and entry_label is only allowed on a group.' | Fix the importGuidanceRules string (user-facing AND embedded in lib/templateImport/aiPromp |
| 4 | medium | 0.97 | concept-drift | `backend/app/models/extraction.py:302` | # Group entry noun ... meaningful only for role='model_container' rows, seeded "model" (B- | Rewrite the column comment: the noun is on EVERY cardinality='many' section; NULL legacy r |
| 5 | medium | 0.93 | concept-drift | `backend/app/schemas/extraction_run.py:244` | # Group entry noun (B-8); pre-B-8 snapshots lack the key -> None and consumers fall back t | Say DEFAULT_ENTRY_LABEL ('entry') and drop 'Group' — the run-view serializer carries the n |
| 6 | medium | 0.93 | concept-drift | `backend/app/services/exports/extraction_snapshot_reader.py:68` | # Group entry noun (B-8) — set on model_container rows; None elsewhere ... consumers fall  | Set on every repeating section; the export stem falls back to DEFAULT_ENTRY_LABEL='entry', |
| 7 | medium | 0.93 | concept-drift | `frontend/hooks/extraction/useTemplateEntityTypes.ts:33` | /** Repeating-group entry noun (B-8) — null on non-containers; consumers interpolate with  | Sibling of the docstring the PR updated in frontend/types/extraction.ts; rewrite it the sa |
| 8 | medium | 0.9 | test-gaps | `frontend/components/extraction/SectionAccordion.tsx:83` | entityType.entry_label ?? DEFAULT_ENTRY_NOUN — fixtures use entry_label:null but assert no | Assert the add/remove affordance reads 'entry' with entry_label:null in SectionAccordion.r |
| 9 | medium | 0.9 | test-gaps | `frontend/hooks/extraction/useAddEntry.ts:147` | entityType?.entry_label ?? DEFAULT_ENTRY_NOUN — no test file for useAddEntry; dialogProps. | Add useAddEntry.test.ts asserting dialogProps.entryLabel is 'entry' for a null noun. |
| 10 | medium | 0.85 | test-gaps | `frontend/pages/ExtractionFullScreen.tsx:805` | four ?? DEFAULT_ENTRY_NOUN fallbacks (805, 1293, 1301, 1321); page tests never reference e | Render a container with entry_label:null and assert the dialogs' copy reads 'entry'. |
| 11 | medium | 0.8 | layered-arch | `frontend/components/extraction/dialogs/AddSectionDialog.tsx:371` | placeholder={DEFAULT_ENTRY_NOUN} in the entry-label FormField — the data constant rendered | Same as f_1: a copy key for the placeholder; keep DEFAULT_ENTRY_NOUN as the data fallback  |
| 12 | medium | 0.8 | layered-arch | `frontend/components/extraction/template-config/TemplateInspectorSectionPane.tsx:221` | placeholder={DEFAULT_ENTRY_NOUN} — user-visible text sourced from lib/extraction/entryKey; | Route the placeholder through frontend/lib/copy/ (or interpolate the constant into a {{nou |
| 13 | medium | 0.75 | layered-arch | `frontend/components/extraction/template-config/sectionRestore.ts:207` | entryLabel: section.cardinality === 'many' ? (section.entryLabel ?? DEFAULT_ENTRY_NOUN) :  | Let the server own the default: accept a NULL noun on the replay/restore path instead of s |
| 14 | medium | 0.7 | legacy | `backend/app/schemas/extraction_run.py:245` | # consumers fall back to "model". | Stale: consumers fall back to DEFAULT_ENTRY_LABEL == 'entry'. |
| 15 | medium | 0.7 | legacy | `frontend/hooks/extraction/useTemplateEntityTypes.ts:34` | consumers interpolate with a 'model' fallback. | Doubly stale after this PR; mirror frontend/types/extraction.ts. |
| 16 | low | 0.95 | legacy | `docs/reference/templates/charms-v1.1-complete.md:327` | SELECT f.name, f.label, ev.value FROM extracted_values ev JOIN extraction_fields f ON f.id | Documented query against the table dropped by 0002; docs/ is outside check_legacy_concepts |
| 17 | low | 0.9 | concept-drift | `backend/app/models/extraction.py:68` | # the export record stem, the portable importer and the entry-group pipeline all fall back | Drop 'the portable importer' — this PR made the importer keep the bundle's noun verbatim;  |
| 18 | low | 0.85 | test-gaps | `frontend/components/extraction/InstanceCard.tsx:77` | default prop entryLabel = DEFAULT_ENTRY_NOUN; the a11y test always passes entryLabel="vali | Render without the prop and assert the 'entry' noun in the rename/remove labels. |
| 19 | low | 0.85 | test-gaps | `frontend/components/extraction/ModelSection.tsx:152` | modelContainer.entry_label ?? DEFAULT_ENTRY_NOUN — the containerType fixture carries entry | Add a ModelSection.test.tsx case with entry_label:null asserting the selector renders 'ent |
| 20 | low | 0.82 | concept-drift | `backend/app/services/extraction_export_service.py:136` | # Group entry noun from the pinned snapshot (B-8) — set on model_container rows; None else | SectionDescriptor.entry_label is populated for any cardinality='many' section; drop the mo |
| 21 | low | 0.82 | concept-drift | `frontend/components/extraction/template-config/templateTree.ts:30` | const ROLE_MODEL_CONTAINER = 'model_container'; | Shadow constant duplicating ENTITY_ROLE.MODEL_CONTAINER from @/lib/extraction/entityTypeRo |
| 22 | low | 0.8 | concept-drift | `backend/app/services/template_section_service.py:154` | if parent.role != "model_container": | Compare against ExtractionEntityRole.MODEL_CONTAINER.value, as template_portable_service a |
| 23 | low | 0.8 | layered-arch | `backend/app/services/template_portable_service.py:238` | entry_label=section.entry_label if repeats else None — writes NULL on a repeating section  | Enforce 'repeating ⇒ noun' at the model/DB layer, or state in the schema docstring that it |
| 24 | low | 0.8 | test-gaps | `backend/app/schemas/template_structure.py:315` | absent/empty/blank params all assert match="entry_label", which pydantic's error loc satis | Split the match: 'required on a repeating section' for None, 'at least 1 character' for bl |
| 25 | low | 0.8 | test-gaps | `frontend/components/extraction/dialogs/AddSectionDialog.tsx:267` | the copy-hints test asserts literal strings, so a hardcoded revert still passes | Assert through t('extraction', ...) so the indirection is what is pinned. |
| 26 | low | 0.75 | test-gaps | `backend/app/services/model_extraction_service.py:399` | container.entry_label or DEFAULT_ENTRY_LABEL for the model-identification prompt changed ' | Assert the identification prompt names 'entry' when the pinned container's entry_label is  |
| 27 | low | 0.75 | test-gaps | `backend/app/services/template_portable_service.py:238` | assert by_name["tail"].entry_label is None is vacuous (tail is non-repeating and its bundl | Drop the assertion (the schema refuses a noun on a non-repeating section before the import |

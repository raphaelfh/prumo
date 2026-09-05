---
status: draft
last_reviewed: 2026-09-04
owner: '@raphaelfh'
---

# Scope — the entry noun on every repeating section (PR 2 of the follow-up train)

Invoked by `/ship-spec` Phase 4 (harden) on the branch
`feat/entry-noun-every-repeating-section` (git range `origin/dev..HEAD`), one
manual cycle. Slice = the production files the diff touches:

- `backend/alembic/versions/0068_seeded_entry_nouns.py`
- `backend/app/models/extraction.py`
- `backend/app/schemas/template_structure.py`
- `backend/app/seed.py`
- `backend/app/services/entry_group_extraction.py`
- `backend/app/services/template_diff.py`
- `backend/app/services/template_portable_service.py`
- `backend/app/services/template_section_service.py`
- `frontend/components/extraction/InstanceCard.tsx`
- `frontend/components/extraction/ModelSection.tsx`
- `frontend/components/extraction/SectionAccordion.tsx`
- `frontend/components/extraction/dialogs/AddSectionDialog.tsx`
- `frontend/components/extraction/hierarchy/AddModelDialog.tsx`
- `frontend/components/extraction/hierarchy/ModelSelector.tsx`
- `frontend/components/extraction/hierarchy/RemoveModelDialog.tsx`
- `frontend/components/extraction/template-config/TemplateInspectorSectionPane.tsx`
- `frontend/components/extraction/template-config/sectionRestore.ts`
- `frontend/components/extraction/template-config/templateTree.ts`
- `frontend/hooks/extraction/useAddEntry.ts`
- `frontend/lib/copy/extraction.ts`
- `frontend/lib/copy/templateConfig.ts`
- `frontend/lib/extraction/entryKey.ts`
- `frontend/pages/ExtractionFullScreen.tsx`
- `frontend/services/templateService.ts`
- `frontend/types/extraction.ts`

Concepts in play: entry group / entry noun (`entry_label`), the one fallback
noun (`DEFAULT_ENTRY_LABEL` / `DEFAULT_ENTRY_NOUN`), the section create
contract (`SectionCreateRequest`), the seeded catalogue and its migration path
(0068), the Undo-after-delete replay, the add-section dialog.

---
status: draft
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Scope — typed `MISSING_ENTITY_KEY` refusal slice

Invoked by `/ship-spec` Phase 4 (harden) on the branch
`claude/entry-key-typed-refusal` (git range `origin/dev..HEAD`), one
manual cycle. Slice = the production files the diff touches:

- `backend/app/services/entity_key.py backend/app/services/extraction_errors.py backend/app/schemas/extraction.py backend/app/api/v1/endpoints/model_extraction.py frontend/lib/ai-extraction/errors.ts frontend/lib/ai-extraction/jobErrorToast.ts frontend/hooks/extraction/useModelExtraction.ts frontend/hooks/extraction/useSectionExtraction.ts frontend/hooks/extraction/ai/useRunAIExtraction.ts frontend/services/sectionExtractionService.ts`

Concepts in play: entry group / entry key (`is_entity_key`), the
`AppError` typed-envelope contract, the async extraction error taxonomy
(`ExtractionErrorCode`), the frontend error-to-toast mapping.

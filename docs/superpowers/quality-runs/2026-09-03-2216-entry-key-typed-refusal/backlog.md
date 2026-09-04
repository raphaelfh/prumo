---
status: draft
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Backlog — TRIAGE of the SCAN (confidence ≥ 0.7, deduped by file/line/category)

| # | sev | conf | category | file:line | finding | action |
|---|---|---|---|---|---|---|
| 1 | medium | 0.95 | legacy | `frontend/lib/ai-extraction/errors.ts:88` | return 'Unknown error'; — user-facing literal outside frontend/lib/copy/; feeds the generi | Route through t('extraction', ...). |
| 2 | medium | 0.9 | test-gaps | `frontend/services/sectionExtractionService.ts:221` | 3 wrap sites pass err.code as APIError's 4th arg; no test asserts it survives — the mocked | Reject modelExtractionClient with the mocked ApiError and assert the thrown APIError.code; |
| 3 | medium | 0.85 | concept-drift | `backend/app/schemas/extraction.py:493` | class SuggestionResponse(BaseModel) ... status: Literal['pending','accepted','rejected'] — | Delete SuggestionResponse. |
| 4 | medium | 0.85 | concept-drift | `backend/app/schemas/extraction.py:509` | class ReviewSuggestionRequest(BaseModel): status: Literal['accepted','rejected'] — review  | Delete ReviewSuggestionRequest. |
| 5 | medium | 0.85 | concept-drift | `frontend/hooks/extraction/ai/useRunAIExtraction.ts:77` | description: `${created} suggestion(s) created across ${successful}/${total} sections.` —  | Move to lib/copy/extraction.ts with placeholders. |
| 6 | medium | 0.85 | legacy | `frontend/lib/ai-extraction/errors.ts:26` | export class PDFNotFoundError is never constructed (new PDFNotFoundError = 0 hits); sole c | Delete PDFNotFoundError and its instanceof guard. |
| 7 | medium | 0.85 | legacy | `frontend/lib/ai-extraction/errors.ts:41` | export class AuthenticationError is never constructed; only use is a never-true instanceof | Delete AuthenticationError and the dead branch. |
| 8 | medium | 0.8 | concept-drift | `backend/app/services/entity_key.py:84` | code="MISSING_ENTITY_KEY" — must stay byte-identical to ExtractionErrorCode.MISSING_ENTITY | Use ExtractionErrorCode.MISSING_ENTITY_KEY.value. |
| 9 | medium | 0.8 | concept-drift | `frontend/lib/ai-extraction/errors.ts:62` | code = 'API_ERROR' with 'PDF_NOT_FOUND' (:30) and 'AUTH_ERROR' (:45) hand-written in the s | Type the class codes against the generated union plus an explicit local union (or delete t |
| 10 | medium | 0.8 | legacy | `frontend/hooks/extraction/useBatchSectionExtractionChunked.ts:217` | Still branches on errorCode === 'PDF_NOT_FOUND' / 'AUTH_ERROR'; neither string is emitted  | Port this hook to showJobErrorToast, deleting the four dead arms. |
| 11 | medium | 0.75 | concept-drift | `frontend/lib/ai-extraction/jobErrorToast.ts:45` | code: string / null / undefined — widened from ExtractionErrorCode; only TITLE_KEY's keys  | Narrow to the union or parse ApiError.code into the union once. |
| 12 | medium | 0.75 | layered-arch | `frontend/lib/ai-extraction/jobErrorToast.ts:62` | showJobErrorToast calls toast.error; sonner imported at :16. Only production lib/ module i | Move showJobErrorToast to frontend/hooks/extraction/ (shared helper next to its 3 callers) |
| 13 | medium | 0.75 | layered-arch | `frontend/services/sectionExtractionService.ts:140` | throw new APIError(err.message, err.status, {traceId}, err.code) — services return ErrorRe | Migrate extractSection/extractModels/extractAllSections to toResult<T> like extractSection |
| 14 | medium | 0.7 | layered-arch | `frontend/services/sectionExtractionService.ts:151` | throw new APIError(jobResult.error.message, undefined, {traceId}) — no code arg; pollUntil | Make pollUntilDone carry error_code from the status payload and forward it as APIError's c |
| 15 | low | 0.9 | legacy | `frontend/services/sectionExtractionService.ts:224` | error instanceof Error ? error.message : "Unknown error" — hardcoded user-facing fallback. | Use a copy key. |
| 16 | low | 0.85 | legacy | `frontend/lib/ai-extraction/jobErrorToast.ts:23` | export interface JobErrorToast has zero importers repo-wide. | Drop the export keyword. |
| 17 | low | 0.85 | legacy | `frontend/lib/ai-extraction/jobErrorToast.ts:44` | export function jobErrorToast has exactly one importer outside its module: its unit test. | Keep exported only if the pure-mapping unit test is the deliberate contract; record it in  |
| 18 | low | 0.8 | concept-drift | `frontend/lib/ai-extraction/jobErrorToast.ts:57` | Module says it serves the sync models kickoff too, but every identifier still says job (jo | Rename to extractionErrorToast / showExtractionErrorToast. |
| 19 | low | 0.8 | test-gaps | `frontend/lib/ai-extraction/jobErrorToast.ts:57` | showJobErrorToast has no direct test; both return values only reach coverage through hooks | Add a direct test: true + toast.error(...) for MISSING_ENTITY_KEY; false + no toast for EX |
| 20 | low | 0.75 | concept-drift | `backend/app/schemas/extraction.py:81` | class FieldSuggestion(BaseModel) — the ProposalRecord payload shape named as a suggestion; | Delete (or rename to ProposalRecordPayload). |
| 21 | low | 0.75 | concept-drift | `backend/app/schemas/extraction.py:571` | suggestions_created: int / None = Field(alias='suggestionsCreated') (also 182,193,211,577) | Plan a wire rename to proposals_created (wire + generated types + hooks) in its own PR. |
| 22 | low | 0.75 | concept-drift | `backend/app/services/extraction_errors.py:1` | 'Error-code taxonomy for async section extraction.' — MISSING_ENTITY_KEY now also travels  | Retitle to 'Error-code taxonomy for extraction failures'; likewise the ASYNC banner at sch |
| 23 | low | 0.7 | concept-drift | `frontend/services/sectionExtractionService.ts:21` | JSDoc example: console.warn(`Created ${result.data?.suggestionsCreated} suggestions`) — AI | Reword when the wire rename lands. |
| 24 | low | 0.7 | layered-arch | `frontend/hooks/extraction/useBatchSectionExtractionChunked.ts:217` | Still hand-rolls PDF_NOT_FOUND / AUTH_ERROR branches after the other three hooks moved to  | Route this hook through the same helper so the mapping has one owner. |

36 rows scanned, 12 dropped below the floor (audit trail in `findings_dropped.jsonl`), 24 in the backlog.

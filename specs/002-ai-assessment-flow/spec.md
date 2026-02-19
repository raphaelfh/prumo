# Feature Specification: AI Assessment Flow

**Feature Branch**: `002-ai-assessment-flow`
**Created**: 2026-02-18
**Status**: Draft
**Input**: The "Avalia com IA" and all AI flow must be working well adapted for the "Avaliacao - avaliar qualidade dos estudos" section. The flow should be similar to the Extracao AI flow. Focus on DRY and KISS principles.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trigger AI Assessment for a Single Item (Priority: P1)

A reviewer is on the quality assessment form for an article. They see a list of assessment items grouped by domain (e.g., PROBAST domains D1-D4). For any item, they can click "Avaliar com IA" to have the AI read the article's PDF and suggest a quality rating with a justification. While the AI is working, a loading indicator shows progress. When complete, the suggestion appears inline next to the item with the suggested level, a confidence score, and the AI's reasoning.

**Why this priority**: This is the core value proposition. Without the ability to trigger AI assessment on individual items, the feature has no purpose. It mirrors the extraction flow's "Extrair com IA" button on individual fields.

**Independent Test**: Can be fully tested by opening any article's assessment form, clicking "Avaliar com IA" on one item, and verifying a suggestion appears with a level, confidence score, and reasoning text.

**Acceptance Scenarios**:

1. **Given** a reviewer is on an article's assessment form with a configured instrument, **When** they click "Avaliar com IA" on an item, **Then** a loading indicator appears, the AI processes the article's PDF, and a suggestion is displayed inline with the suggested level, confidence percentage, and reasoning.
2. **Given** the AI has produced a suggestion for an item, **When** the reviewer views the item, **Then** the suggestion shows the suggested level (from the item's allowed levels), a confidence score (0-100%), and a text justification citing evidence from the article.
3. **Given** the AI cannot determine a quality level for an item (e.g., information not found in the PDF), **When** the assessment completes, **Then** the suggestion indicates "Not Applicable" or "Insufficient Information" with an explanation of what was missing.
4. **Given** no PDF is available for the article, **When** the user clicks "Avaliar com IA", **Then** a clear error message informs the user that a PDF is required for AI assessment.

---

### User Story 2 - Accept or Reject AI Suggestions (Priority: P1)

After the AI produces a suggestion for an assessment item, the reviewer can accept it (which fills in their assessment response with the AI's suggested level and justification) or reject it (which dismisses the suggestion). The reviewer can also modify the suggestion before accepting - choosing a different level while keeping the AI's reasoning, or editing the justification.

**Why this priority**: Equal to P1 because suggestions without accept/reject are useless. This mirrors the extraction flow's accept/reject pattern.

**Independent Test**: Can be tested by triggering an AI assessment (US1), then accepting or rejecting the resulting suggestion, and verifying the form state updates correctly.

**Acceptance Scenarios**:

1. **Given** an AI suggestion is displayed for an assessment item, **When** the reviewer clicks "Accept", **Then** the assessment response is filled with the suggested level and justification, the suggestion status changes to "accepted", and the form shows the accepted value.
2. **Given** an AI suggestion is displayed, **When** the reviewer clicks "Reject", **Then** the suggestion is dismissed, the suggestion status changes to "rejected", and the assessment item remains empty (or returns to its previous value).
3. **Given** an AI suggestion has been accepted, **When** the reviewer changes the level manually, **Then** the assessment response updates to the new level, and the AI suggestion remains recorded for audit history.
4. **Given** a previously accepted suggestion exists, **When** the reviewer clicks "Reject" to reverse their decision, **Then** the assessment response is cleared and the suggestion status changes to "rejected".

---

### User Story 3 - Batch AI Assessment (Priority: P2)

A reviewer wants to run AI assessment on all items of an instrument at once, rather than clicking "Avaliar com IA" one by one. They click a "Avaliar Tudo com IA" button (in the form header area) which processes all required items for the current article in a single operation. The PDF is loaded once and reused across all items. Previous AI context from earlier items is carried forward for coherence.

**Why this priority**: Significant productivity gain. Assessing 15-30 items individually is tedious. This mirrors the extraction flow's "Extrair com IA" full-article extraction.

**Independent Test**: Can be tested by clicking "Avaliar Tudo com IA" on an article with a multi-item instrument and verifying all items receive suggestions.

**Acceptance Scenarios**:

1. **Given** a reviewer is on an article's assessment form with multiple items, **When** they click "Avaliar Tudo com IA", **Then** the system processes all required items sequentially, showing progress (e.g., "Avaliando item 3 de 15"), and generates suggestions for each item.
2. **Given** a batch assessment is in progress, **When** one item fails (AI error, timeout), **Then** the system continues with the remaining items, marks the failed item with an error indicator, and reports the partial results.
3. **Given** some items already have accepted responses, **When** the user triggers batch assessment, **Then** only items without accepted responses are processed (existing accepted responses are preserved).

---

### User Story 4 - Batch Accept High-Confidence Suggestions (Priority: P3)

After a batch AI assessment produces multiple suggestions, the reviewer can accept all suggestions above a confidence threshold (e.g., 80%) in one click. This is useful when the AI has high confidence on many items and the reviewer trusts the results. A badge in the assessment form header shows the count of pending suggestions.

**Why this priority**: Convenience feature that saves time after batch assessment. Not critical for MVP. Mirrors the extraction flow's batch accept pattern.

**Independent Test**: Can be tested by running a batch assessment, then clicking "Aceitar com alta confianca" and verifying all high-confidence suggestions are accepted.

**Acceptance Scenarios**:

1. **Given** multiple pending AI suggestions exist for an article, **When** the reviewer clicks "Aceitar com alta confianca", **Then** all suggestions with confidence above the threshold (default 80%) are accepted automatically, and their responses are saved.
2. **Given** a badge shows "5 sugestoes pendentes" in the header, **When** the reviewer batch-accepts 3 high-confidence suggestions, **Then** the badge updates to show "2 sugestoes pendentes".

---

### Edge Cases

- What happens when the article's PDF is very large (100+ pages)? The system should use the first N pages or a summary approach, with a warning to the reviewer.
- What happens when the user's AI API key is invalid or has no credits? A clear error message should appear, suggesting they check their API key configuration.
- What happens when the assessment instrument has no items configured? The "Avaliar com IA" buttons should not appear, and a message should prompt the user to configure the instrument first.
- What happens when two reviewers trigger AI assessment on the same article simultaneously? Each receives independent suggestions; suggestions are tied to the user who triggered them.
- What happens when the assessment uses a hierarchical instrument (e.g., PROBAST per prediction model)? The AI assessment should scope to the specific model/instance being assessed, not the entire article.
- What happens when the user navigates away while a batch assessment is running? The operation should continue in the background, and results should be available when the user returns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow reviewers to trigger AI assessment on individual assessment items via a clearly labeled button ("Avaliar com IA").
- **FR-002**: System MUST display AI suggestions inline next to the assessment item, showing the suggested level, confidence score (0-100%), and textual justification with evidence from the article.
- **FR-003**: System MUST allow reviewers to accept a suggestion (filling the assessment response with the suggested level and justification) or reject it (dismissing the suggestion without changing the response).
- **FR-004**: System MUST support batch AI assessment, processing all required items for an article in a single operation, reusing the loaded PDF across all items.
- **FR-005**: System MUST track each AI assessment operation as a run with status lifecycle (pending, running, completed, failed) for auditability.
- **FR-006**: System MUST only suggest levels that are within the item's configured allowed levels.
- **FR-007**: System MUST show a count badge of pending (unreviewed) AI suggestions in the assessment form header.
- **FR-008**: System MUST support batch acceptance of suggestions above a configurable confidence threshold.
- **FR-009**: System MUST show a loading/progress indicator during AI assessment operations, both for single-item and batch assessments.
- **FR-010**: System MUST display clear error messages when AI assessment fails (no PDF available, invalid API key, network error, AI service unavailable).
- **FR-011**: System MUST preserve the reviewer's manually entered responses when AI assessment is triggered; AI suggestions should never overwrite existing accepted responses unless the reviewer explicitly accepts the new suggestion.
- **FR-012**: System MUST support hierarchical assessments where the AI assessment is scoped to a specific extraction instance (e.g., a specific prediction model for PROBAST).
- **FR-013**: System MUST reuse existing patterns from the extraction AI flow wherever possible, following DRY principles to avoid duplicating logic for suggestion management, accept/reject workflows, and confidence display.

### Key Entities

- **AI Assessment Run**: Tracks a single AI assessment operation. Contains the article, instrument, status, timing, and results metadata. Scoped to a project and optionally to an extraction instance.
- **AI Suggestion**: A pending AI recommendation for an assessment item. Contains the suggested quality level, confidence score, reasoning/justification, and evidence passages from the article. Linked to the run that produced it.
- **Assessment Response**: The reviewer's final answer for an assessment item. Contains the selected level, justification, and optionally a reference to the AI suggestion that produced it. This is the "accepted" artifact.
- **Assessment Instrument (Project)**: The project-specific copy of an assessment tool (e.g., PROBAST, QUADAS-2) with its items and configured allowed levels.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Reviewers can trigger AI assessment on a single item and see a suggestion within 30 seconds for typical academic articles (under 50 pages).
- **SC-002**: Reviewers can run batch AI assessment on all items of an instrument and see all suggestions within 5 minutes for a typical instrument (15-30 items).
- **SC-003**: 100% of AI suggestions display a confidence score, reasoning text, and a level from the item's allowed levels.
- **SC-004**: Reviewers can accept or reject any AI suggestion with a single click, and the form state updates immediately.
- **SC-005**: The AI assessment flow reduces the time to complete a full quality assessment for one article by at least 50% compared to manual entry.
- **SC-006**: The pending suggestions badge accurately reflects the count of unreviewed suggestions at all times.
- **SC-007**: Error states (no PDF, invalid API key, AI failure) produce user-friendly messages in 100% of cases, with no unhandled errors or blank screens.
- **SC-008**: The AI assessment feature reuses at least 70% of the existing suggestion management patterns from the extraction flow (shared components, hooks, or services), minimizing new code duplication.

## Assumptions

- The existing backend AI assessment endpoint (`/api/v1/ai-assessment/ai`) and service (`AIAssessmentService`) are functional and produce correct suggestions. This feature focuses on wiring the frontend correctly and ensuring the end-to-end flow works.
- The existing `AISuggestion` database table is shared between extraction and assessment features, with appropriate fields to distinguish between the two.
- Users have already configured their AI API key (via the existing API key management feature) before attempting AI assessment.
- The article's PDF has already been uploaded to storage before attempting AI assessment.
- Assessment instruments have been imported and configured for the project before AI assessment is triggered.
- The extraction AI flow (suggestion inline display, accept/reject, batch operations, confidence badges) is the reference implementation that this feature should mirror.

## Scope

### In Scope

- Connecting the "Avaliar com IA" button to the backend assessment endpoint
- Displaying AI suggestions inline in the assessment form
- Accept/reject workflow for suggestions
- Batch assessment trigger ("Avaliar Tudo com IA")
- Batch accept high-confidence suggestions
- Pending suggestions badge count
- Loading and error states
- Run tracking and progress display

### Out of Scope

- Changes to the AI model or prompt engineering (existing prompts are used as-is)
- New assessment instrument creation or import flows (already working)
- PDF upload or storage functionality (already working)
- API key management UI (already working)
- Extraction flow changes (reference only, not modified)
- Real-time collaboration (multiple reviewers seeing each other's suggestions live)

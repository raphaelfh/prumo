# Feature Specification: Fix Assessment Instrument Configuration and Data Loading

**Feature Branch**: `001-fix-assessment-instrument`
**Created**: 2026-02-17
**Status**: Draft
**Input**: User description: "Fix bugs in the Avaliacao (quality assessment) section: instrument variable editing after import and article assessment data loading errors"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edit Imported Assessment Instrument Items (Priority: P1)

A researcher imports a quality assessment instrument (e.g., a standardized checklist) into their project's "Avaliacao" section. After importing, they need to customize the instrument by enabling, disabling, reordering, or modifying the items (questions/criteria) within the instrument configuration. Currently, the configuration becomes read-only after import, preventing any modifications.

The working "Extracao" (Extraction) section provides the gold-standard reference for how instrument/template configuration should behave after import: users can freely add, remove, reorder, and modify fields/entity types within a project-scoped template.

**Why this priority**: Without the ability to customize imported instruments, researchers are forced to use instruments exactly as-is, which does not match the real-world workflow where instruments are often adapted for specific systematic review protocols. This is a core functionality blocker.

**Independent Test**: After importing an assessment instrument, the user can successfully open the instrument configuration, toggle items on/off, reorder items, and save changes. Reloading the page preserves the modifications.

**Acceptance Scenarios**:

1. **Given** an imported assessment instrument in a project, **When** the user opens the instrument configuration panel, **Then** all items are displayed as editable (not read-only).
2. **Given** the instrument configuration panel is open, **When** the user toggles an item on or off, reorders items, modifies an item's properties, or adds a new custom item, **Then** the changes are immediately reflected in the UI and persisted on save.
3. **Given** saved configuration changes, **When** the user navigates away and returns to the configuration, **Then** all previously saved changes are preserved.

---

### User Story 2 - Load Assessment Data for Article Quality Review (Priority: P1)

A researcher navigates to the "Avaliacao" tab and selects an article to perform quality assessment. The system loads the assessment instrument, previous responses, and any AI suggestions. Currently, the system fails with a data loading error ("Cannot coerce the result to a single JSON object") when querying the assessment instrument, preventing the user from performing any quality assessment.

**Why this priority**: This is an equally critical blocker because even if the instrument is configured, researchers cannot use it to assess any article. The quality assessment workflow is completely broken.

**Independent Test**: The user navigates to any article within the "Avaliacao" section, and the assessment instrument, its questions, and any existing responses load successfully without errors.

**Acceptance Scenarios**:

1. **Given** a project with an imported assessment instrument and articles, **When** the user navigates to the "Avaliacao" tab and selects an article, **Then** the assessment instrument loads successfully with all its questions displayed.
2. **Given** a successfully loaded assessment form, **When** the user answers questions and navigates between articles, **Then** responses are saved and loaded correctly for each article.
3. **Given** any state of assessment data (new, partially completed, fully completed), **When** the page is refreshed or the user returns later, **Then** all data loads without errors and reflects the correct state.
4. **Given** a project with AI assessment suggestions previously generated, **When** the user opens an article for assessment, **Then** both the manual form and AI suggestions load successfully.

---

### User Story 3 - Consistent UX Between Extraction and Assessment Sections (Priority: P2)

The "Extracao" (Extraction) section has a well-functioning flow for importing, configuring, and using templates within a project. The "Avaliacao" (Assessment) section should follow the same interaction patterns, visual cues, and workflow steps to provide a consistent user experience. The Extraction section is the gold standard.

**Why this priority**: Consistency between sections reduces cognitive load and support requests. Users who learn one section can immediately apply that knowledge to the other.

**Independent Test**: A user who is familiar with the Extraction section can perform the complete assessment workflow (import instrument, configure items, assess articles) without encountering unexpected differences in behavior or UI patterns.

**Acceptance Scenarios**:

1. **Given** a user in the "Avaliacao" configuration panel, **When** they compare the workflow to the "Extracao" configuration panel, **Then** the import, configuration, and editing patterns are functionally equivalent.
2. **Given** the assessment instrument is loaded for an article, **When** the user interacts with the form, **Then** the data loading, saving, and navigation patterns match those in the extraction workflow.

---

### Edge Cases

- What happens when an instrument is imported into a project that already has one? The new instrument replaces the previous one (one instrument per project). The old instrument and all its associated assessment responses are deleted (dev stage, no legacy data preservation needed).
- What happens when the imported instrument has no items? The configuration should display an empty state with guidance.
- What happens when an item is removed from the configuration after some articles have already been assessed using that item? Existing responses should be preserved but the item should no longer appear for new assessments.
- What happens when the user has no network connectivity while saving configuration changes? An appropriate error message should be displayed and changes should not be silently lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to edit (enable/disable, reorder, modify properties of), delete, and add new custom assessment instrument items after importing an instrument into a project.
- **FR-002**: System MUST persist assessment instrument configuration changes across sessions.
- **FR-003**: System MUST successfully load assessment instrument data when a user opens an article for quality assessment, without returning data coercion errors.
- **FR-004**: System MUST load and display existing assessment responses when a user returns to a previously assessed article.
- **FR-005**: System MUST follow the same import-configure-use workflow pattern established by the "Extracao" (Extraction) section.
- **FR-006**: System MUST display appropriate error messages when data loading fails, rather than breaking silently or showing raw technical errors.
- **FR-007**: System MUST correctly query for a single assessment instrument record without triggering multi-row coercion errors (the root cause of the 406 "Cannot coerce to single JSON object" error).
- **FR-008**: System MUST enforce a one-instrument-per-project constraint. Importing a new instrument into a project that already has one deletes the old instrument and its associated responses, then creates the new one.
- **FR-009**: System MUST correctly load AI assessment suggestions for the active instrument when a user opens an article for quality assessment, without errors.

### Key Entities

- **Assessment Instrument**: A quality assessment checklist or tool (e.g., ROBINS-I, NOS) that defines the criteria for evaluating study quality. Contains metadata and references to its domains/items.
- **Assessment Item**: An individual question or criterion within an assessment instrument (formerly referred to as "variable"). Has properties like question text, description, allowed response levels, and sort order. Maps to `ProjectAssessmentItem` in code.
- **Assessment Response**: A user's answer to an individual instrument item for a specific article. Tracks the evaluator, article, instrument item, and chosen response.
- **Project Assessment Instrument**: The association between a project and its configured assessment instrument, including any project-specific customizations. A project has exactly one active assessment instrument at a time (1:1 cardinality).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of users can successfully edit assessment instrument items after import, matching the same success rate as the Extraction template configuration.
- **SC-002**: 100% of article quality assessment pages load without errors when the user has a valid imported instrument.
- **SC-003**: Users can complete the full assessment workflow (import instrument, configure items, assess an article) in under 5 minutes, comparable to the Extraction workflow timing.
- **SC-004**: Zero data coercion or query errors appear in the browser console during normal assessment operations.
- **SC-005**: The assessment configuration and article assessment UX receives the same user satisfaction scores as the existing Extraction section UX.

## Clarifications

### Session 2026-02-17

- Q: How many assessment instruments can a project use simultaneously? → A: One instrument per project (like Extraction uses one template). Re-importing replaces the old.
- Q: Is the AI-powered assessment suggestion feature in scope for this fix? → A: Yes, in scope. Fix must ensure both manual assessment and AI suggestions load correctly.
- Q: Canonical term for individual questions/criteria: "variable" or "item"? → A: "Item" — aligned with codebase (`ProjectAssessmentItem`, `assessment_items`). "Variable" deprecated from spec.
- Q: Is adding new custom items to a cloned instrument in scope? → A: Yes, full CRUD (add, edit, toggle, delete) is in scope — matching Extraction's TemplateConfigEditor pattern.
- Q: How to handle old assessment data when instrument is replaced? → A: Delete all old data (instrument + responses). Dev stage, no legacy preservation. No backward-compat code.

## Assumptions

- The "Extracao" (Extraction) section's current implementation is stable and represents the desired gold-standard behavior for template/instrument management.
- The "Cannot coerce the result to a single JSON object" error is caused by a query returning multiple rows (or zero rows) when a single-row result is expected, likely due to how the instrument is queried after cloning.
- The Supabase local connection refused errors in the console logs are unrelated to the core bugs (they indicate Supabase was not running at the time of initial page load, before authentication).
- Assessment instrument configuration editing should support the same level of granularity as extraction template configuration (toggle items, reorder, modify properties).

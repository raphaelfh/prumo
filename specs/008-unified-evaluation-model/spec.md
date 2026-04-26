# Feature Specification: Unified Evaluation Data Model

**Feature Branch**: `008-unified-evaluation-model`  
**Created**: 2026-04-26  
**Status**: Draft  
**Input**: User description: "Unified evaluation data model for extraction, quality, multi-reviewer consensus, and schema versioning"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execute a Unified Evaluation Run (Priority: P1)

As a project manager, I can start one evaluation run that covers extraction and quality checks for selected targets so the team follows one consistent workflow from proposal to final publication.

**Why this priority**: This is the core value of the feature. Without a unified run lifecycle, teams still operate in fragmented processes and cannot reliably move work from AI proposal to reviewed final output.

**Independent Test**: Create a run for a set of targets and verify the run progresses through proposal, review, and final publication while keeping all events linked to the same run context.

**Acceptance Scenarios**:

1. **Given** a published evaluation schema version and a set of targets, **When** a manager starts a run, **Then** the system creates one run context and tracks all item-level evaluations under that run.
2. **Given** an active run, **When** proposals are produced for each target and item, **Then** reviewers can access those proposals in a review queue tied to the same run.

---

### User Story 2 - Support Independent Multi-Reviewer Decisions (Priority: P2)

As a reviewer, I can make independent accept, reject, or edit decisions for each evaluated item so each reviewer opinion is captured without overwriting others.

**Why this priority**: Independent reviewer history is required for quality governance and auditability. It enables disagreement handling and supports robust final decisions.

**Independent Test**: For one target and item, have two reviewers submit different decisions and verify both decisions are preserved with reviewer-specific current states.

**Acceptance Scenarios**:

1. **Given** a proposal for a target and item, **When** Reviewer A accepts and Reviewer B edits the same item, **Then** both decisions are stored as separate records with reviewer identity and timestamps.
2. **Given** a reviewer has already decided on an item, **When** the reviewer submits a new decision, **Then** the historical decision record remains and the reviewer current state updates to reflect the latest decision.

---

### User Story 3 - Publish Final Consensus with Governance Controls (Priority: P3)

As a final decision maker, I can publish a consensus outcome by selecting an existing reviewer decision or applying a manual override with justification so the published result is authoritative and auditable.

**Why this priority**: Final publication closes the loop and turns reviewer activity into authoritative outputs used by downstream workflows.

**Independent Test**: Publish final consensus for reviewed items using both "pick existing" and "manual override" modes, and verify mandatory justification for overrides plus update of published state.

**Acceptance Scenarios**:

1. **Given** at least one reviewer decision exists, **When** the final decision maker picks one reviewer decision for publication, **Then** the selected value becomes the authoritative published state and links to the consensus decision record.
2. **Given** reviewer decisions exist but none should be used directly, **When** the final decision maker publishes a manual override, **Then** the system requires justification and stores the override as an auditable consensus event.

---

### Edge Cases

- A reviewer submits a decision for an item that no longer exists in the active schema version.
- Two final decision makers attempt to publish consensus for the same target and item at nearly the same time.
- A new schema version adds or changes items while older version results must remain visible and unchanged.
- A run fails partway through processing and must preserve partial history without presenting incomplete data as final.
- A user with reviewer privileges attempts to publish consensus outside their authorization scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support one unified evaluation lifecycle that handles extraction and quality work under a single run context.
- **FR-002**: The system MUST allow creation and publication of versioned evaluation schemas, where each published version remains immutable.
- **FR-003**: The system MUST evaluate work at atomic item level for each target so item-level proposals, reviews, and publication are independently traceable.
- **FR-004**: The system MUST record all proposals as append-only history, including source attribution and creation timestamp.
- **FR-005**: The system MUST allow multiple reviewers to create independent decisions for the same target and item without overwriting one another.
- **FR-006**: The system MUST maintain each reviewer current state per target and item as a materialized view of their most recent decision.
- **FR-007**: The system MUST allow authorized final decision makers to publish consensus by selecting an existing reviewer decision or providing a manual override.
- **FR-008**: The system MUST require a non-empty justification whenever consensus is published via manual override.
- **FR-009**: The system MUST maintain one authoritative published state per target, item, and schema version that always links to the latest consensus decision.
- **FR-010**: The system MUST keep historical proposal, decision, and consensus records immutable after creation.
- **FR-011**: The system MUST enforce project-level data isolation so users can only access and modify records within permitted project scope.
- **FR-012**: The system MUST support evidence attachments that can be linked to proposal, reviewer decision, consensus decision, or published state records.
- **FR-013**: The system MUST preserve all results from prior schema versions when a newer schema version is promoted.
- **FR-014**: The system MUST initialize reviewer and publication status for newly introduced or incompatible items when a newer schema version is promoted.
- **FR-015**: The system MUST track run status and stage transitions so stakeholders can distinguish pending, active, completed, failed, and cancelled runs.
- **FR-016**: The system MUST keep application data model changes managed through the backend migration workflow, with schema evolution tracked as versioned migrations.
- **FR-017**: The system MUST include a repeatable schema consistency verification step that confirms the resulting database structure matches the approved data model before release.

### Key Entities *(include if feature involves data)*

- **Evaluation Schema**: Business definition of evaluation fields and rules for a specific domain scope.
- **Schema Version**: Immutable snapshot of an evaluation schema used during runs.
- **Evaluation Item**: Atomic field/question evaluated for each target.
- **Evaluation Target**: Entity being evaluated (for example, an article or another reviewable object).
- **Evaluation Run**: Operational context grouping all evaluation activity for selected targets and schema version.
- **Proposal Record**: Suggested value and context for one target-item pair generated by AI, human, or system source.
- **Reviewer Decision Record**: Reviewer action (accept/reject/edit) against a proposal or item state.
- **Reviewer State**: Current reviewer-specific status for each target-item pair.
- **Consensus Decision Record**: Final publication action and rationale selected by authorized decision maker.
- **Published State**: Authoritative final value and status for each target-item pair.
- **Evidence Record**: Supporting reference data linked to proposals, decisions, consensus, or published states.

### Assumptions & Dependencies

- Project roles and permissions already exist and can identify reviewer and final decision-maker capabilities.
- Downstream consumers can read authoritative published state by schema version.
- Historical append-only data volume will grow over time and operational monitoring will guide scaling adjustments.
- The initial release may rebuild existing development data, and preserving old development records is not required.
- All feature-facing written deliverables are authored in English, and implementation outputs provide complete code blocks rather than partial fragments when code is requested.
- Database lifecycle ownership follows the backend migration standard for application schema evolution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, 100% of configured evaluation runs can progress from run creation to final publication without requiring manual data repair.
- **SC-002**: In pilot usage, at least 95% of reviewed items receive an explicit reviewer decision within one business day of proposal generation.
- **SC-003**: In governance audit sampling, 100% of published items can be traced to a consensus decision with actor identity, timestamp, and rationale when override mode is used.
- **SC-004**: In schema promotion tests, 100% of previously published outcomes remain available under their original schema version after introducing a new version.
- **SC-005**: For cross-project authorization tests, 100% of unauthorized read/write attempts are blocked.
- **SC-006**: In release validation, 100% of schema consistency checks pass by confirming the deployed database structure matches the approved model definition.

# Feature Specification: Zotero Article Data Parity

**Feature Branch**: `006-zotero-articles-sync`  
**Created**: 2026-03-28  
**Status**: Draft  
**Input**: User description: "vamos atualizar a tabela do articles para que todos os campos que existem no zotero
estejam la examatamente da mesma maneira e para que a forma de receber os artigos do zotero esteja planejado para
receber todas as informacoes da api do zotero e fique salvo adequadamente no projeto. use a documentacao do zotero para
pesquisa as APIs https://www.zotero.org/support/dev/start https://www.zotero.org/support/dev/web_api/v3/start"

## Clarifications

### Session 2026-03-28

- Q: How should author data be modeled to keep Zotero parity and integration with other tables? -> A: Option C (hybrid
  model: nested parity payload plus structured relational representation).
- Q: Should the article model include extra non-Zotero fields for extracted text and semantic-search readiness? -> A:
  Option C (include pdf extracted text and semantic-search optimized fields, clearly separated from source-parity data).
- Q: In conflicts, which source should win for parity and enrichment fields? -> A: Option B (Zotero wins parity fields;
  local enrichment fields are preserved and not overwritten by sync).
- Q: What should happen when an article is removed from Zotero source? -> A: Option B (mark as removed-at-source with
  logical soft-delete, preserving history and local enrichments).
- Q: Which identity should be primary for synchronization and uniqueness? -> A: Option A (Zotero canonical identity is
  primary; DOI/ISBN/URL are auxiliary identifiers).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete Metadata Ingestion (Priority: P1)

As a product operator, I want every available article field from a Zotero record to be accepted by the platform so no
source information is lost during import.

**Why this priority**: Data completeness is the core business value of this feature. Without full ingestion, the
integration is not trustworthy.

**Independent Test**: Can be fully tested by importing a representative Zotero article sample containing optional and
uncommon fields and confirming all source fields are preserved in the stored record.

**Acceptance Scenarios**:

1. **Given** a source article with standard bibliographic metadata, **When** the article is imported, **Then** all
   source fields are present in the stored article data with equivalent meaning.
2. **Given** a source article with optional, empty, and custom metadata fields, **When** the article is imported, **Then
   ** empty values are handled safely and custom fields are preserved without data loss.

---

### User Story 2 - Reliable Historical Sync (Priority: P2)

As an operations user, I want previously imported Zotero articles to stay aligned with source updates so local records
remain accurate over time.

**Why this priority**: Data drift causes trust issues and downstream errors in review and reporting workflows.

**Independent Test**: Can be tested by importing an article, changing source metadata in Zotero, running a new sync, and
confirming local data reflects the latest source state according to defined update rules.

**Acceptance Scenarios**:

1. **Given** an article already imported into the platform, **When** the source metadata changes and sync runs again, *
   *Then** the local record is updated consistently without duplicating the article.
2. **Given** source fields that are removed or set to empty later, **When** sync runs, **Then** the local record
   reflects the removal or empty state according to parity rules.

---

### User Story 3 - Traceable Import Outcomes (Priority: P3)

As a support analyst, I want clear import status and error visibility per article so I can identify incomplete sync
events and recover quickly.

**Why this priority**: Operational observability reduces diagnosis time and lowers risk when processing large article
volumes.

**Independent Test**: Can be tested by processing a batch with valid and invalid source records and verifying per-record
outcome, error reason, and retry eligibility are visible.

**Acceptance Scenarios**:

1. **Given** a mixed import batch, **When** processing finishes, **Then** each article has a clear outcome state (
   success, skipped, failed) with timestamped processing details.
2. **Given** a record that fails validation or mapping, **When** the failure is logged, **Then** the reason is explicit
   enough for support to decide whether to retry, correct source data, or ignore.

---

### Edge Cases

- Source records include unknown field keys not previously seen in the platform.
- Source records contain nested values with arrays, structured objects, or mixed types.
- Two source records map to the same canonical identifier.
- A source record has no DOI/ISBN but has a valid Zotero canonical identity.
- Source sends null, blank, or type-incompatible values for fields previously stored with valid values.
- Partial batch interruptions occur (timeout, upstream rate limits, temporary outages) after some records are already
  saved.
- A sync detects divergent values in source-parity fields and local enrichment fields within the same article update
  cycle.
- A source article previously synchronized is no longer returned by Zotero in later synchronization cycles.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain a field registry for Zotero article metadata that represents all currently
  supported source fields and supports future field additions without destructive migration.
- **FR-002**: The system MUST store article data in a way that preserves one-to-one semantic parity between Zotero
  source fields and local article fields.
- **FR-003**: The system MUST preserve source-provided values for standard, optional, and custom metadata fields,
  including empty values where intentionally present.
- **FR-004**: The system MUST validate incoming records and reject only records that cannot be safely persisted, while
  continuing to process other valid records in the same batch. Validation failures MUST be classified into at least:
  schema/field validation error, source mapping error, authorization error, and upstream dependency error.
- **FR-005**: The system MUST prevent duplicate local article records across repeated imports by enforcing Zotero
  canonical identity as the primary synchronization uniqueness key, while treating bibliographic identifiers (
  DOI/ISBN/URL) as auxiliary metadata only.
- **FR-006**: The system MUST support deterministic update behavior when source metadata changes, including updates,
  removals, and value replacements.
- **FR-007**: The system MUST persist provenance metadata per article import, including source identity, processing
  timestamp, and import outcome.
- **FR-008**: The system MUST record structured error details for failed records, including failed field context and a
  human-actionable reason.
- **FR-009**: Users MUST be able to reprocess failed or partially processed imports without corrupting already
  synchronized records.
- **FR-010**: The system MUST produce import summaries for each sync execution, including total records received,
  persisted, updated, skipped, and failed.
- **FR-011**: The system MUST enforce access boundaries so article data is only created or updated for the authorized
  workspace context associated with the sync request.
- **FR-012**: The system MUST keep existing non-Zotero article data behavior unchanged for records not managed by Zotero
  synchronization.
- **FR-013**: The system MUST represent author data using a hybrid model, preserving line-by-line source parity in
  article metadata while also maintaining a structured cross-record author representation for integrations and
  consistent queries.
- **FR-014**: The system MUST keep both author representations synchronized so updates in source author lists are
  reflected without creating contradictory author states.
- **FR-015**: The system MUST support explicit enrichment fields in the article domain for PDF extracted text and
  semantic-search readiness, while preserving strict separation between source-parity metadata and enriched local
  metadata.
- **FR-016**: The system MUST allow semantic-search preparation for both abstract and full-article content without
  changing the original Zotero field semantics.
- **FR-017**: The system MUST apply conflict precedence rules where Zotero is authoritative for source-parity fields and
  local enrichment data remains authoritative for enrichment-only fields.
- **FR-018**: The system MUST keep conflict handling deterministic and auditable by recording which authority rule was
  applied when values differ.
- **FR-019**: The system MUST handle source removals using logical deactivation semantics, marking the article as
  removed-at-source without destructive deletion of local historical or enrichment data.
- **FR-020**: The system MUST support reversible reactivation when a previously removed-at-source article reappears in
  Zotero, restoring active sync status without creating duplicates.
- **FR-021**: The system MUST retain DOI, ISBN, URL, and equivalent bibliographic identifiers as auxiliary matching and
  discovery metadata without overriding canonical synchronization identity.
- **FR-022**: The system MUST enforce a source-agnostic canonical ingestion contract so that Zotero, RIS, and manual
  imports normalize into the same article identity, deduplication, and conflict-resolution rules.

### Key Entities *(include if feature involves data)*

- **Zotero Source Article**: External bibliographic record containing identifiers, descriptive metadata, creators,
  dates, links, and optional custom fields.
- **Canonical Sync Identity**: Stable Zotero-provided identity used as the authoritative key for import idempotency,
  update targeting, and deduplication.
- **Local Article**: Internal canonical article record that stores source-parity metadata plus local operational
  attributes, including source lineage metadata to distinguish Zotero, RIS, and manual ingestion paths without changing
  canonical identity rules.
- **Article Sync State**: Lifecycle state for synchronized articles (active, removed-at-source, reactivated) used to
  preserve history and control visibility rules.
- **Canonical Author**: Structured author identity used for cross-article relationships, deduplication support, and
  interoperability with other domain records.
- **Article-Author Association**: Ordered relationship between one article and one canonical author, including role and
  source-order semantics.
- **Article Enrichment Payload**: Local-only enrichment data that includes extracted full-text content and
  semantic-search oriented content representations, distinct from source metadata.
- **Article Import Event**: Auditable event representing one attempt to ingest or sync one source article, including
  status, timestamps, and error context.
- **Sync Execution Summary**: Aggregate record describing one synchronization run, counts by outcome, and integrity
  indicators.
- **Field Registry**: Managed catalog of recognized source field names and parity expectations used to validate
  completeness.

### Assumptions

- A single source article has a stable external identity that can be used for idempotent synchronization.
- Source API contracts can evolve, so the solution must tolerate new fields without blocking ingestion.
- Workspace authorization context is already available at sync invocation time.

### Dependencies

- Continued availability of Zotero API metadata definitions and article payload structure.
- Access to authorized Zotero libraries required for source extraction.
- Existing article lifecycle workflows must accept enriched metadata without breaking downstream processes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of fields present in a sampled set of representative Zotero article payloads are persisted with
  equivalent meaning in local article records.
- **SC-002**: At least 99% of valid source articles in a sync run complete without manual intervention.
- **SC-003**: Duplicate creation rate for repeated imports of unchanged source data is 0%.
- **SC-004**: For source updates, at least 99% of changed fields are reflected in local records after the next completed
  sync cycle.
- **SC-005**: Support can diagnose the reason for failed imports using recorded error data in under 5 minutes for 95% of
  failure cases.

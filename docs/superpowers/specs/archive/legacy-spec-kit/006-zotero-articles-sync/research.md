# Research: Zotero Article Data Parity

**Feature**: 006-zotero-articles-sync  
**Date**: 2026-03-28

## 1. Full Zotero field coverage strategy

**Decision**: Preserve the full Zotero item payload in a parity JSON field while keeping a typed projection in
`articles`
for high-value query fields already used by the product.

**Rationale**: This keeps exact source fidelity for new/rare fields and prevents data loss when Zotero adds fields,
while
still supporting efficient filtering/sorting through typed columns.

**Alternatives considered**:

- Typed columns only for all Zotero fields: rejected because schema churn would be high and fragile.
- JSON payload only: rejected because existing product workflows depend on typed article columns.

---

## 2. Author modeling (line-by-line + relational interoperability)

**Decision**: Adopt a hybrid model: keep source-order author entries in article parity payload and maintain canonical
author entities with article-author associations for cross-table integration and dedup support.

**Rationale**: Meets the clarified requirement to keep line-by-line Zotero semantics without sacrificing relational
consistency and interoperability with other project features.

**Alternatives considered**:

- Nested list only in article record: rejected due to weak cross-article joins and difficult dedup.
- Relational only: rejected because source-order and raw creator details can be lost.

---

## 3. Conflict precedence between source parity and local enrichment

**Decision**: Use deterministic split authority:

- Zotero is authoritative for source-parity fields.
- Local system is authoritative for enrichment-only fields (PDF extracted text, semantic-search-ready content).

**Rationale**: Preserves synchronization correctness while allowing local value-added processing to evolve
independently.

**Alternatives considered**:

- Local always wins: rejected due to source drift.
- Zotero always wins globally: rejected because enrichment would be unintentionally overwritten.

---

## 4. Source removal behavior

**Decision**: Implement logical deactivation (`removed_at_source`) instead of destructive deletion, with reversible
reactivation if the same canonical Zotero identity returns.

**Rationale**: Keeps auditability and avoids loss of local enrichment/history while still reflecting source truth.

**Alternatives considered**:

- Hard delete on source removal: rejected due to irreversible local data loss.
- Ignore removals: rejected due to stale data risk.

---

## 5. Primary synchronization identity

**Decision**: Use canonical Zotero identity as the primary idempotency and uniqueness key; keep DOI/ISBN/URL as
auxiliary
identifiers.

**Rationale**: DOI/ISBN are not guaranteed to exist or be unique enough across all item types. Zotero canonical identity
is the most stable sync anchor for this integration.

**Alternatives considered**:

- DOI-first identity: rejected due to missing DOI in many records.
- Hash-based identity from payload: rejected due to instability across harmless source edits.

---

## 6. Batch reliability and retries

**Decision**: Process sync in asynchronous batches via Celery with per-item outcomes and retry support for failed items.
Store sync run summary and item-level failure reason for diagnostics.

**Rationale**: Matches project async architecture and supports large collection imports without request timeouts.

**Alternatives considered**:

- Fully synchronous import endpoint: rejected due to timeout and poor recoverability under scale.
- Retry whole batch only: rejected because it repeats successful work and increases conflict risk.

---

## 7. Semantic-search preparation fields

**Decision**: Add explicit enrichment fields for:

- extracted PDF full text;
- normalized semantic-search content for abstract;
- normalized semantic-search content for full article text.

**Rationale**: Creates clear boundaries between source metadata and local NLP/search preparation, enabling future
semantic
indexing without remapping Zotero fields.

**Alternatives considered**:

- Single generic enrichment blob: rejected due to poor validation and unclear ownership.
- No enrichment fields now: rejected because clarified scope explicitly includes this capability.

---

## 8. Contract style consistency with existing Zotero integration

**Decision**: Keep the existing action-oriented Zotero API style (`/api/v1/zotero/{action}`) and extend action set for
sync, status, and retry while preserving `ApiResponse` envelope.

**Rationale**: Minimizes frontend churn, keeps integration consistent with current `zoteroClient`, and follows
constitution API constraints.

**Alternatives considered**:

- Create a separate REST namespace for sync only: acceptable but deferred to avoid unnecessary API shape divergence.

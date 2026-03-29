# Data Model: Zotero Article Data Parity

**Feature**: 006-zotero-articles-sync  
**Date**: 2026-03-28

## Overview

This feature extends the existing article ingestion model to guarantee Zotero parity and robust synchronization while
preserving local enrichment capabilities. The model introduces explicit sync lifecycle state and canonical author
structures that remain connected to `articles`.

## Entities

### 1) Local Article (`public.articles`, extended)

Represents the internal article record linked to a project.

**Key fields (existing + extended):**

- `id` (UUID, PK)
- `project_id` (UUID, FK -> `projects.id`)
- `zotero_item_key` (text, nullable but unique per project when present)
- `zotero_collection_key` (text, nullable)
- `zotero_version` (integer, nullable)
- `source_payload` (JSONB; full parity payload)
- `sync_state` (enum/string: `active` | `removed_at_source` | `reactivated`)
- `removed_at_source_at` (timestamp, nullable)
- `last_synced_at` (timestamp)
- `sync_conflict_log` (JSONB, optional audit details)
- `pdf_extracted_text` (text, enrichment-only)
- `semantic_abstract_text` (text, enrichment-only normalized abstract content)
- `semantic_fulltext_text` (text, enrichment-only normalized full-text content)

**Identity and uniqueness:**

- Primary sync identity: (`project_id`, `zotero_item_key`) when `zotero_item_key` exists.
- DOI/ISBN/URL are auxiliary discovery identifiers only.

**Validation rules:**

- `title` remains required.
- Enrichment fields must not overwrite source parity fields.
- `sync_state=removed_at_source` implies `removed_at_source_at` is populated.

---

### 2) Canonical Author (`public.article_authors`, new)

Represents reusable author identity records for interoperability and consistent queries.

**Key fields:**

- `id` (UUID, PK)
- `normalized_name` (text, required)
- `display_name` (text, required)
- `orcid` (text, nullable)
- `source_hint` (text/json, nullable; optional raw source cues)
- `created_at`, `updated_at`

**Uniqueness and matching:**

- Uniqueness constraint on (`normalized_name`, `orcid`) where `orcid` present.
- Fallback dedup by `normalized_name` when `orcid` absent.

---

### 3) Article-Author Association (`public.article_author_links`, new)

Represents ordered authorship of an article while preserving source semantics.

**Key fields:**

- `id` (UUID, PK)
- `article_id` (UUID, FK -> `articles.id`)
- `author_id` (UUID, FK -> `article_authors.id`)
- `author_order` (integer, required; 0-based or 1-based, fixed convention in implementation)
- `creator_type` (text; e.g., author/editor)
- `raw_creator_payload` (JSONB; source line-by-line parity data)

**Constraints:**

- Unique (`article_id`, `author_order`) to keep deterministic order.
- Unique (`article_id`, `author_id`, `creator_type`) to avoid duplicate links.

---

### 4) Article Sync Event (`public.article_sync_events`, new)

Auditable record per processed source item in a sync execution.

**Key fields:**

- `id` (UUID, PK)
- `project_id` (UUID)
- `article_id` (UUID, nullable for pre-create failures)
- `zotero_item_key` (text)
- `sync_run_id` (UUID/string)
- `status` (`success` | `updated` | `skipped` | `failed` | `removed_at_source` | `reactivated`)
- `authority_rule_applied` (text; e.g., `source_parity_wins`, `local_enrichment_wins`)
- `error_code` (text, nullable)
- `error_message` (text, nullable)
- `processed_at` (timestamp)

**Purpose:**

- Supports failure diagnosis, retry targeting, and deterministic audit trails.

---

### 5) Sync Execution Summary (`public.article_sync_runs`, new)

Aggregate execution record for one asynchronous sync run.

**Key fields:**

- `id` (UUID/string, PK)
- `project_id` (UUID)
- `requested_by_user_id` (UUID/text)
- `started_at`, `completed_at`
- `status` (`pending` | `running` | `completed` | `failed` | `cancelled`)
- `total_received`, `persisted`, `updated`, `skipped`, `failed`, `removed_at_source`, `reactivated`
- `failure_summary` (JSONB)

**Purpose:**

- Provides status polling payload and operational observability.

## Relationships

- `Project 1:N Article`
- `Article 1:N ArticleAuthorAssociation`
- `CanonicalAuthor 1:N ArticleAuthorAssociation`
- `Article 1:N ArticleSyncEvent`
- `SyncExecutionSummary 1:N ArticleSyncEvent`
- `Project 1:N SyncExecutionSummary`

## State Transitions

### Article sync lifecycle

- `active` -> `removed_at_source` when source no longer includes canonical item.
- `removed_at_source` -> `reactivated` when source item reappears.
- `reactivated` -> `active` after successful parity refresh.

### Sync run lifecycle

- `pending` -> `running` -> (`completed` | `failed` | `cancelled`)

## Authority Rules

1. Source parity fields: Zotero is authoritative.
2. Enrichment-only fields: local system is authoritative.
3. Every conflict resolution records `authority_rule_applied` in sync event data.

## Data Integrity Notes

- Sync writes must be idempotent under repeated job execution with same input.
- Failed item retries must not duplicate article records or author links.
- Soft-deleted (`removed_at_source`) records remain referentially intact for downstream features.

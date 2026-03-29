# Zotero Article Sync API Contract

**Feature**: 006-zotero-articles-sync  
**Base path**: `/api/v1/zotero/{action}`  
**Auth**: Required (JWT). User identity always derived from token (`user.sub`).

## Contract style

This feature extends the existing action-based Zotero endpoint style and keeps:

- `ApiResponse(ok=True, data=..., trace_id=...)` for success;
- `ApiResponse(ok=False, error=..., trace_id=...)` for failures.

## Actions

| Action              | Purpose                                                  |
|---------------------|----------------------------------------------------------|
| `sync-collection`   | Start asynchronous sync for a project collection.        |
| `sync-status`       | Get status and aggregate/result counters for a sync run. |
| `sync-retry-failed` | Retry only failed items from a previous run.             |
| `sync-item-result`  | Fetch item-level diagnostics for support and UI details. |

---

## 1) Start sync

**Endpoint**: `POST /api/v1/zotero/sync-collection`

### Request body

| Field                | Type    | Required | Description                                                  |
|----------------------|---------|----------|--------------------------------------------------------------|
| `projectId`          | UUID    | Yes      | Project context for article writes and authorization checks. |
| `collectionKey`      | string  | Yes      | Zotero collection key to synchronize.                        |
| `maxItems`           | integer | No       | Optional upper bound for initial sync scope.                 |
| `includeAttachments` | boolean | No       | Whether attachment discovery/extraction flow should run.     |
| `updateExisting`     | boolean | No       | Whether existing synchronized records should be updated.     |

### Response 202

| Field       | Type   | Description                                                   |
|-------------|--------|---------------------------------------------------------------|
| `syncRunId` | string | Identifier for polling status and fetching detailed outcomes. |
| `status`    | string | Initial status (`pending`).                                   |
| `message`   | string | Human-readable summary.                                       |

### Error responses

- `400`: Invalid payload (missing `projectId`, malformed `collectionKey`, etc.)
- `403`: User not authorized for project.
- `404`: Project not found.
- `429`: Rate limit exceeded.

---

## 2) Sync status

**Endpoint**: `POST /api/v1/zotero/sync-status`

### Request body

| Field       | Type   | Required | Description                                        |
|-------------|--------|----------|----------------------------------------------------|
| `syncRunId` | string | Yes      | Sync run identifier returned by start sync action. |

### Response 200

| Field         | Type   | Description                                                                             |
|---------------|--------|-----------------------------------------------------------------------------------------|
| `syncRunId`   | string | Requested sync run ID.                                                                  |
| `status`      | string | `pending` \| `running` \| `completed` \| `failed` \| `cancelled`.                       |
| `counts`      | object | `{ totalReceived, persisted, updated, skipped, failed, removedAtSource, reactivated }`. |
| `startedAt`   | string | ISO-8601 datetime.                                                                      |
| `completedAt` | string | ISO-8601 datetime when finished (nullable).                                             |
| `traceId`     | string | Request trace identifier (mirrors envelope trace_id).                                   |

### Error responses

- `403`: Sync run does not belong to requesting user/project scope.
- `404`: Unknown or expired sync run ID.

---

## 3) Retry failed items

**Endpoint**: `POST /api/v1/zotero/sync-retry-failed`

### Request body

| Field       | Type    | Required | Description                                                    |
|-------------|---------|----------|----------------------------------------------------------------|
| `syncRunId` | string  | Yes      | Source run used to identify retry candidates.                  |
| `limit`     | integer | No       | Optional cap on number of failed items retried in one request. |

### Response 202

| Field              | Type    | Description                                |
|--------------------|---------|--------------------------------------------|
| `syncRunId`        | string  | New retry sync run identifier.             |
| `retryOfSyncRunId` | string  | Original run identifier.                   |
| `queuedItems`      | integer | Number of failed items accepted for retry. |

### Error responses

- `400`: Original run has no failed items.
- `403`: Unauthorized retry attempt.
- `404`: Original run not found.

---

## 4) Item-level diagnostics

**Endpoint**: `POST /api/v1/zotero/sync-item-result`

### Request body

| Field          | Type    | Required | Description                                                       |
|----------------|---------|----------|-------------------------------------------------------------------|
| `syncRunId`    | string  | Yes      | Sync run identifier.                                              |
| `statusFilter` | string  | No       | Optional filter (`failed`, `updated`, `removed_at_source`, etc.). |
| `offset`       | integer | No       | Pagination offset.                                                |
| `limit`        | integer | No       | Pagination size.                                                  |

### Response 200

| Field    | Type    | Description                                                                                                                            |
|----------|---------|----------------------------------------------------------------------------------------------------------------------------------------|
| `items`  | array   | List of item outcomes with `zoteroItemKey`, `articleId`, `status`, `errorCode`, `errorMessage`, `authorityRuleApplied`, `processedAt`. |
| `total`  | integer | Total matched records for the filter.                                                                                                  |
| `offset` | integer | Current offset.                                                                                                                        |
| `limit`  | integer | Current page size.                                                                                                                     |

### Error responses

- `403`: Unauthorized access to run diagnostics.
- `404`: Sync run not found.

---

## Behavioral guarantees

- Idempotent behavior for repeated sync of unchanged source records.
- Source parity fields follow Zotero authority.
- Enrichment-only fields remain under local authority.
- Source removals result in logical deactivation (no destructive deletion).

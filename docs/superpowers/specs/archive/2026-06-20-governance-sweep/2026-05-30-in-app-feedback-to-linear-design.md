---
status: shipped
last_reviewed: 2026-05-30
owner: '@raphaelfh'
branch: claude/unruffled-driscoll-369e6c
---

> **Status:** Draft — pending review. Not yet implemented.

# Design: In-App Feedback → Linear (one-way intake)

**Date:** 2026-05-30
**Branch:** `claude/unruffled-driscoll-369e6c`
**Scope:** Bridge user-submitted feedback (bugs, suggestions, questions) captured inside the app to the Linear **Prumo (`PRU`)** team, with optional screenshot/screen-recording, via a durable store-and-forward outbox.

## 1. Context

### 1.1 What already exists

A feedback widget was scaffolded on the frontend but never connected to anything actionable:

- [`frontend/components/feedback/FeedbackButton.tsx`](../../../frontend/components/feedback/FeedbackButton.tsx) — icon button wired into the Topbar.
- [`frontend/components/feedback/FeedbackDialog.tsx`](../../../frontend/components/feedback/FeedbackDialog.tsx) — type (`bug`/`suggestion`/`question`/`other`) + severity + description.
- [`frontend/hooks/useFeedback.ts`](../../../frontend/hooks/useFeedback.ts) — captures context (URL, project/article ids, viewport, user agent) and writes **directly to Supabase** (`feedback_reports`), bypassing the backend. The hook sent `type`/`description`/… fields that **did not match the actual table columns** (see correction note below) — it was effectively broken.
- `feedback_reports` table — exists in `baseline_v1.sql`, RLS-enabled, with free-form columns `category` (text), `message` (text), `metadata` (jsonb), and `status` (text). No structured `type`/`severity`/`description`/`url`/etc. columns existed. It is a "SQL-only" table today — no ORM model, no `/api/v1` endpoint.

> **Correction (2026-05-30):** The original draft of this spec incorrectly described `feedback_reports` as having `type`/`description`/`severity`/`url`/etc. columns. That was wrong — the table had `category`/`message`/`metadata`/`status` (confirmed in `backend/alembic/versions/baseline_v1.sql` and the generated Supabase types). The spec was written by trusting the hand-authored TypeScript interface in `useFeedback.ts` rather than the generated types. As a consequence, the committed migration `0020_feedback_outbox.py` differs from the spec's §5.1 "Keep/Add/Drop" assumption: it **adds** all the structured columns (including `type`, `description`, `url`, etc.) from scratch, **backtracks** by migrating `message`→`description` and `category`→`summary`, and **drops** the legacy free-form columns. See §5.1 for the corrected as-built description.

### 1.2 The gap

Nothing forwards `feedback_reports` rows anywhere. Reports accumulate in a table no one looks at. There is no triage surface, no screenshot capture (the `screenshot_url` column is always null), and no link to the team's actual work tracker.

### 1.3 Target

The team already runs **Linear** (workspace `prumo-ai`, one team **Prumo / `PRU`**, project "Review Hub - Roadmap 2026"). Linear is where bugs and feature work are triaged and executed. The goal is to route in-app feedback into Linear so user complaints + feature requests land in one place, enriched with the context (and optionally a screenshot/clip) needed to act on them.

### 1.4 Is this a modern flow? Yes

In-app feedback → issue tracker is the standard pattern. Off-the-shelf widgets (Marker.io, Userback, Featurebase, Feedbucket) all capture feedback in-app and create a Linear issue with screenshots + context, mapping *type → label* and *severity → priority*, landing in Linear's **Triage** inbox for a daily triage routine. Linear also exposes a GraphQL API (`issueCreate`, `attachmentCreate`, file upload) and a native **Customer Requests** layer. Building our own thin bridge (rather than adopting a paid widget) keeps data ownership, costs nothing per seat, and reuses the existing widget + table + Celery/httpx/structlog stack.

## 2. Decision

Build an **in-house bridge**:

1. **Loop scope: one-way intake.** Feedback auto-creates a Linear issue in Triage. The team triages and works entirely in Linear. No status flows back to the app (deferred — see §13).
2. **Persistence: slim outbox.** Refactor `feedback_reports` into a store-and-forward log; persist on submit, forward to Linear asynchronously via Celery with idempotent retries. Drop the dead triage columns.
3. **Capture: `getDisplayMedia()` (still frame + optional short clip).** Pixel-accurate (captures prumo's PDF.js viewer, where DOM-screenshot libraries render blank), one mechanism for both image and video. Opt-in per report, with preview-before-send.
4. **Forwarding is server-side.** The Linear API key is a secret and must never reach the browser — which also aligns with prumo's "no direct browser inserts, go through `/api/v1`" convention.

### Alternatives considered

| Approach | Why not |
|---|---|
| Third-party widget (Marker.io / Userback) | Per-seat cost, new vendor receiving data, discards the widget + table already built. |
| Linear-native intake only (Customer Requests / form / email-to-Linear) | No in-app context, no app-state-aware screenshots, weak UX. |
| Direct to Linear, **no** local table | A failed/timed-out forward loses the report; no retry buffer, audit trail, analytics, or `auth.user → issue` mapping. Media (multi-step upload) makes this collapse — see §3. |
| Keep the full table (status/priority/admin_notes) | Carries an in-app-triage workflow we are explicitly not building; Linear owns triage now. |

## 3. Foundational decisions (locked in brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Loop scope | **One-way intake** | Centralizes feedback in Linear with the least surface area; two-way sync deferred. |
| Persistence | **Slim outbox** (`feedback_reports` + `feedback_attachments`) | Durable (no loss if Linear is down), retryable, idempotent, analytics-friendly, keeps reporter↔issue mapping. |
| Why outbox over direct (with media) | **Media forces it** | An issue-with-media is 2–3 sequential Linear calls (create → `fileUpload` → attach), each fail-prone; large blobs must not ride the synchronous submit request; the blob needs a durable staging home + a record to retry from idempotently; cleanup needs the row. "Direct, no table" just reinvents a worse outbox. |
| Capture method | **`getDisplayMedia()`** still frame + optional ≤30s webm clip | Accurate on the PDF viewer (DOM-screenshot libs taint on `<canvas>`/PDF.js); one API for image + video. Trade-off: a "share your screen" prompt per capture. |
| Capture consent | **Opt-in + preview-before-send**, with a visible "shared with the Prumo team in Linear" notice | Media can contain sensitive PDFs / unpublished research and goes to an external system. Never automatic. |
| Submit response | **202, async forward** | User success decoupled from Linear uptime. Consequence: the success toast is generic ("report sent"), not "tracked as PRU-123" — the issue does not exist yet at submit time. |
| Linear asset hosting | **Upload into Linear** (its `fileUpload`) | Linear hosts the asset permanently; avoids an expiring Supabase signed URL breaking the embed later. |
| Storage upload | **Backend-minted signed upload URL** | Least-privilege: no standing client write policy on the bucket. (Alt: browser-direct upload with scoped RLS, mirroring article files.) |
| Blob lifecycle | **Delete after `forward_status=sent`** | Linear holds its own copy; minimizes the sensitive-data footprint. |
| Triage columns | **Drop** `status` / `priority` / `admin_notes` / `screenshot_url` | Linear owns triage; child table owns attachments. |

## 4. End-to-end flow

### 4.1 Submit (synchronous, fast)

1. User opens the Topbar feedback dialog → type + severity + description (+ optional summary).
2. *(Opt-in)* **Attach screenshot** or **Record clip** → `getDisplayMedia()` prompt → capture → **preview & keep/discard**.
3. On submit: if media exists, the browser `PUT`s the blob(s) to **Supabase Storage** (via a backend-minted signed upload URL) and obtains storage key(s); then it `POST`s to `POST /api/v1/feedback` with text fields + context + the **keys** (never the bytes).
4. Backend (`FeedbackService`): validate → insert `feedback_reports` (`forward_status=pending`) + one `feedback_attachments` row per key → enqueue `forward_feedback_to_linear_task` → return **202** `ApiResponse{ ok, data: { report_id } }`.

### 4.2 Forward (async, retryable, idempotent — Celery)

5. `forward_feedback_to_linear_task(report_id)`:
   - Load report. **If `linear_issue_id` is already set, skip issue creation** (idempotent re-entry).
   - Build the issue body + resolve labels (type→label, severity→native priority, route→area, + `source:in-app`) → Linear `issueCreate` in team `PRU`, routed to **Triage** → store `linear_issue_id` / `linear_identifier` / `linear_url`; set `forward_status=issue_created`.
   - For each `pending` attachment: download from Storage → Linear `fileUpload` (request upload URL, `PUT` blob) → embed asset in the issue body (and/or `attachmentCreate`) → set attachment `forward_status=sent`, store `linear_asset_url`.
   - Set report `forward_status=sent`, `forwarded_at=now()`.
6. On any failure: record `forward_error`, raise → Celery retry with backoff. Terminal failures rest at `forward_status=failed` for an ops sweep / manual re-enqueue.
7. *(Optional cleanup task)* delete Storage blobs once `forward_status=sent`.

**Failure semantics:** the user always sees success (report captured); the outbox guarantees eventual delivery. Idempotency is anchored on `linear_issue_id` (report) + per-attachment `forward_status`.

## 5. Data model

### 5.1 `feedback_reports` (slimmed to an outbox)

> **As-built note (2026-05-30):** The table did NOT already have `type`/`description`/etc. — the real legacy columns were `category`/`message`/`metadata`/`status`. The committed migration `0020_feedback_outbox.py` therefore **adds** every structured column listed below, **backfills** legacy data (`message`→`description`, `category`→`summary`), and **drops** the legacy columns. The "Keep/Add/Drop" framing in the original draft assumed a different starting schema.

Give it a first-class ORM model ([`backend/app/models/feedback.py`](../../../backend/app/models/feedback.py)) and remove it from the "SQL-only" exclusion list in [`backend/alembic/env.py`](../../../backend/alembic/env.py).

| column | type | notes |
|---|---|---|
| `id` | uuid PK | keep |
| `user_id` | uuid FK → `auth.users` | `ON DELETE SET NULL` (keep) |
| `type` | text | `bug` \| `suggestion` \| `question` \| `other` — **added** |
| `severity` | text, nullable | `low` \| `medium` \| `high` \| `critical` — **added** |
| `summary` | text, nullable | optional one-line title — **added** (backfilled from legacy `category`) |
| `description` | text | 10–5000 chars — **added** (backfilled from legacy `message`) |
| `url` | text, nullable | page URL — **added** |
| `route` | text, nullable | logical route — **added** |
| `project_id` | uuid FK → `projects`, nullable | validated for membership if present — **added** |
| `article_id` | uuid FK → `articles`, nullable | **added** |
| `user_agent` | text, nullable | **added** |
| `viewport_size` | jsonb, nullable | `{ width, height }` — **added** |
| `app_version` | text, nullable | build SHA if exposed — **added** |
| `linear_issue_id` | text, nullable | idempotency anchor — **added** |
| `linear_identifier` | text, nullable | e.g. `PRU-123` — **added** |
| `linear_url` | text, nullable | **added** |
| `forward_status` | text | `pending` \| `issue_created` \| `sent` \| `failed`, default `pending` — **added** |
| `forward_error` | text, nullable | **added** |
| `forwarded_at` | timestamptz, nullable | **added** |
| `created_at` / `updated_at` | timestamptz | `TimestampMixin` (keep) |

**Dropped (legacy free-form columns):** `category`, `message`, `metadata`, `status`.

### 5.2 `feedback_attachments` (new)

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `feedback_report_id` | uuid FK → `feedback_reports.id` | `ON DELETE CASCADE` |
| `kind` | text | `image` \| `video` |
| `storage_key` | text | Supabase Storage path |
| `content_type` | text | `image/png` \| `image/webp` \| `image/jpeg` \| `video/webm` |
| `size_bytes` | int, nullable | |
| `linear_asset_url` | text, nullable | URL after upload into Linear |
| `forward_status` | text | `pending` \| `sent` \| `failed`, default `pending` |
| `created_at` / `updated_at` | timestamptz | |

### 5.3 RLS

The client no longer writes this table (backend uses service-role). Drop the permissive `feedback_reports_insert` policy; restrict both tables to `service_role`. Defense in depth.

### 5.4 Migration

Single Alembic migration: add outbox + Linear columns, create `feedback_attachments`, drop the dead triage columns, tighten RLS. Provide a working `downgrade()`.

## 6. Linear mapping

Grounded in the Prumo team's existing labels (`Bug`, `Feature`, `Improvement`, `area:pdf`, `area:extraction`, `area:ui-ux`, `area:database`, `area:multi-user`, `area:multi-provider`, `type:*`, `priority:*`).

- **Team:** Prumo (`PRU`), id `9b86c9ed-ede9-4f36-99d1-c2f53fb82370`. Routed to **Triage**.
- **Labels to create:** `Question`, `source:in-app` (prefix matches the existing `area:`/`type:`/`priority:` convention).
- **Type → label:** `bug → Bug`, `suggestion → Feature`, `question → Question`, `other → ` (no type label). Every forwarded report also gets **`source:in-app`**.
- **Severity → native Linear priority field:** `critical → Urgent (1)`, `high → High (2)`, `medium → Medium (3)`, `low → Low (4)`, none → `No priority (0)`.
- **Route → area label (best-effort):** PDF viewer → `area:pdf`; extraction screens → `area:extraction`; settings/UI → `area:ui-ux`; etc. Skipped when no confident match.
- **Title:** `summary` if provided, else `[<Type>] <truncated description>`.
- **Body (markdown):** the description, then a **Context** block — reporter (name + email), local `report_id`, page URL/route, project (name/id), article (title/id), app version, browser, viewport, submitted-at — then the embedded screenshot/clip.

Label resolution caches label ids per process to avoid a lookup per issue. Missing labels are created on first use (or provisioned once at deploy).

## 7. Backend modules

| File | Change |
|---|---|
| `backend/app/models/feedback.py` | **New** `FeedbackReport` + `FeedbackAttachment` (`BaseModel` + `UUIDMixin` + `TimestampMixin`). |
| `backend/alembic/env.py` | Remove `feedback_reports` from the SQL-only exclusion list. |
| `backend/alembic/versions/00NN_feedback_outbox.py` | **New** migration (§5.4). |
| `backend/app/schemas/feedback.py` | **New** Pydantic v2: `FeedbackCreate`, `FeedbackCreated` (→ `report_id`), `SignedUploadRequest`/`SignedUploadResponse`, type/severity enums. |
| `backend/app/services/feedback_service.py` | **New** `create_report(user, payload)` → validate, persist, enqueue. |
| `backend/app/services/linear/linear_client.py` | **New** httpx async (per-request) Linear client: `issue_create`, `file_upload`, `attachment_create`/embed; label-id cache. |
| `backend/app/services/linear/feedback_mapping.py` | **New** type→label, severity→priority, route→area; issue body template. |
| `backend/app/api/v1/endpoints/feedback.py` | **New** `POST /api/v1/feedback` (`CurrentUser`, `DbSession`, `@limiter.limit("10/minute")`) + `POST /api/v1/feedback/uploads` (signed upload URL). Register in the v1 router aggregator. |
| `backend/app/worker/tasks/feedback_tasks.py` | **New** `forward_feedback_to_linear_task` (`LoggedTask`, retries/backoff, `worker_session`, idempotent). Add a `feedback` queue route in `backend/app/worker/celery_app.py`. |
| `backend/app/core/config.py` | Add `LINEAR_API_KEY` (secret), `LINEAR_TEAM_ID`, `FEEDBACK_MEDIA_BUCKET`, and size/duration caps. |
| `docs/reference/deployment.md` | Document the new env vars; set them on Railway (`LINEAR_API_KEY` as a secret). |

Responses use the standard `ApiResponse{ ok, data, error, trace_id }` envelope; errors use `ErrorDetail` + `ApiErrorCode`.

## 8. Frontend modules

| File | Change |
|---|---|
| `frontend/hooks/useFeedback.ts` | Replace the direct Supabase insert with a TanStack Query mutation → `apiClient('/api/v1/feedback', …)`. |
| `frontend/integrations/api/feedbackService.ts` | **New** `submitFeedback(payload)` + `requestUploadUrl()`. |
| `frontend/hooks/useScreenCapture.ts` | **New** wraps `getDisplayMedia()`: `captureStill()` (one frame → canvas → webp/png blob) and `recordClip(maxSec)` (`MediaRecorder` → webm); stops tracks after; graceful permission-denied handling. |
| `frontend/components/feedback/FeedbackDialog.tsx` | Add **Attach screenshot** / **Record clip** buttons, preview + discard, the "shared with the Prumo team in Linear" notice, optional **summary** field. Reuse `frontend/hooks/useFileUpload.ts` for the Storage `PUT`. |
| `frontend/lib/copy/` | New i18n keys (no hardcoded strings). |

**Async-UX consequence:** because forwarding is async, the submit response cannot include the `PRU-123` identifier. The success toast is generic ("Thanks — your report was sent").

## 9. Storage

- **Bucket:** `feedback-media` (private). Path `feedback/{user_id}/{uuid}/{file}`.
- **Upload:** backend mints a short-lived **signed upload URL** (extends the `StorageAdapter` `get_signed_url` work); browser `PUT`s the blob; then posts the key. *(Alt: browser-direct upload with a scoped RLS policy, mirroring the article-file flow.)*
- **Lifecycle:** cleanup task deletes the blob after `forward_status=sent`.
- **Caps (client + server):** image ≤ 10 MB; clip ≤ 30 s / ≤ 50 MB; MIME allowlist `image/png|webp|jpeg`, `video/webm`.

## 10. Security / privacy / abuse

- Auth required (`CurrentUser`); **10/min** per-principal rate limit (SlowAPI, `backend/app/utils/rate_limiter.py`).
- Capture is **opt-in + preview-before-send** — the consent gate, since media goes to an external system. Never automatic.
- Server validation: MIME allowlist, size caps, description 10–5000 chars; if `project_id`/`article_id` are supplied, verify membership via `ensure_project_member`, else null them.
- `LINEAR_API_KEY` is server-side only.

## 11. Observability

structlog binds `report_id`, `user_id`, `linear_issue_id`, forward attempt count, outcome, and latency. The `LoggedTask` base already logs task lifecycle (`on_failure`/`on_success`/`on_retry`).

## 12. Test plan

Integration-first; written alongside each layer (not batched at the end).

- **Backend (pytest):**
  - Endpoint integration: `POST /api/v1/feedback` persists report + attachments, returns 202, enqueues the task; auth-required; rate-limit; validation rejects bad MIME / oversize / short description; `project_id` membership enforced.
  - Forwarder: **mock only the httpx → Linear boundary.** Assert the `issueCreate` payload (team, labels, priority, body), the `fileUpload` → attach sequence, **idempotency** (re-run with `linear_issue_id` set does not duplicate), retry + `forward_status` transitions, terminal `failed`.
  - Migration up/down.
- **Frontend (vitest):** `useScreenCapture` with `getDisplayMedia` mocked (success + permission-denied); `FeedbackDialog` opt-in/preview/discard/submit with **MSW v2** mocking `/api/v1/feedback`; `useFeedback` mutation success/error.
- Targets the 80% diff-coverage gate.

## 13. Out of scope (future)

- **Two-way status sync** — Linear webhook → `feedback_reports.status`, plus an in-app "my reports" view (reintroduce a status column then).
- **Reporter notifications** on resolution (in-app/email).
- **Session replay** (rrweb / Sentry Replay) — pairs with the commented-out Sentry hooks in `frontend/services/errorTracking.ts`.
- **Screenshot annotation/markup** (Marker.io-style).
- **Dedup/merge** of similar reports (rely on Linear Triage's "mark duplicate").
- **Linear Customer-Request linkage** (tie the reporter as a Linear "customer").
- **In-app admin triage UI.**

## 14. Build sequence

1. **Data layer** — ORM models + migration (slim table, child table, RLS) + model tests.
2. **Linear client + mapping** — httpx client, label/priority/area mapping, body template; unit tests at the httpx boundary; provision `Question` + `source:in-app` labels.
3. **Backend endpoint + service + Celery task** — `POST /api/v1/feedback`, signed-upload endpoint, forward task (idempotent, retrying); endpoint + forwarder tests.
4. **Storage** — `feedback-media` bucket, signed-upload mint, cleanup task.
5. **Frontend** — `useScreenCapture`, refactor `useFeedback` to the API, enhance `FeedbackDialog` (capture/preview/summary/notice), i18n; vitest.
6. **Config/deploy** — env vars on Railway, `deployment.md`, end-to-end smoke against the Prumo team.

## 15. Open questions / risks

- **`getDisplayMedia()` UX:** users must pick "this tab" for a clean capture; the picker is unavoidable friction. Acceptable given the PDF-fidelity requirement.
- **`app_version`:** no build SHA is exposed today; either add a Vite build-time define or leave the column null initially.
- **Label provisioning:** create `Question` + `source:in-app` once at deploy vs. lazily on first use — pick during implementation (lazy is simplest, deploy-time avoids a first-request race).
- **Linear rate limits:** the Celery backoff must respect Linear's API rate limits; surface repeated 429s to logs.

## Sources

- [Marker.io — Linear integration](https://marker.io/linear-website-issue-tracker), [Userback — Linear](https://userback.io/integration/linear/)
- [Linear Docs — Customer Requests](https://linear.app/docs/customer-requests), [Linear Developers — Managing Customers](https://linear.app/developers/managing-customers)
- [snapDOM (html2canvas alternative)](https://zumerlab.github.io/snapdom/) — context on DOM-screenshot fidelity/perf limits
- [Sentry — Session Replay privacy/masking](https://docs.sentry.io/platforms/javascript/session-replay/privacy/) — context for the deferred replay option

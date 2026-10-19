---
status: approved
last_reviewed: 2026-10-19
owner: '@raphaelfh'
---

# Parse provenance and a memory guard for opt-in Docling — design

> The parser choice is settled. The PyMuPDF-vs-Docling bake-off
> (`docs/superpowers/quality-runs/2026-10-18-2106-pymupdf-vs-docling/`, #1036)
> and the ADR-0011 amendment of 2026-10-19 keep the status quo: `auto` →
> LlamaParse when a `llama_cloud` key resolves, else PyMuPDF; Docling stays
> opt-in per project, set by a project manager. This spec does not reopen that.
> It fixes two gaps the investigation found around that decision:
> **(1)** no document records which parser produced its blocks (constitution
> §IX), and **(2)** a single opt-in can take down the shared worker, because a
> Docling parse peaks at ~5.7 GB and the worker runs two prefork children in
> 8 GB alongside extractions, imports and exports.

## 1. Evidence

### 1.1 Production (Supabase `prumo`, Railway `prumo/production`, 2026-10-18)

| Fact | Value |
| --- | --- |
| Projects / parser preference | 5 / all unset → `auto` |
| `article_files` by status | 23 `parsed`, 0 `parse_failed`, 0 `pending` |
| Pages per parsed file | 4–23 |
| Worker, last 7 days | RAM avg 0.45 GB / max 0.51 GB; CPU ≈ 0 |
| Web, last 7 days | RAM avg 0.32 GB / max 0.33 GB |
| Parser that produced each file | **unknown** — nothing records it |

### 1.2 Docling cost (local, Apple M5 Pro, docling 2.104.0, OCR off, FAST)

| PDF | Pages | PyMuPDF | Docling 1st / warm | Docling peak RSS |
| --- | ---: | ---: | ---: | ---: |
| J Gen Intern Med | 5 | 1.1 s | 4.1 / 2.5 s | 3.1 GB |
| BMJ 2023 | 14 | 2.8 s | 9.2 / 8.0 s | 3.3 GB |
| Nature 2024 | 23 | 5.8 s | 14.9 / 13.7 s | 5.5 GB |
| npj Digit Med | 48 | 5.1 s | 18.4 / 16.7 s | 6.5 GB |

The #1036 run on 14 PMC papers agrees: median 5.4 s, peak 5.7 GB. Threads
(1/4/8) move wall time by ≤ 15%; a per-process converter singleton saves 1–2 s.
Time is far from the 600 s soft limit; **memory is the risk**: two concurrent
Docling parses (≈ 11–13 GB) exceed the 8 GB worker, and the OOM kill takes the
in-flight extraction and export tasks with it.

## 2. Parse provenance

- **Port.** `DocumentParser` gains a read-only `provenance` returning
  `ParseProvenance` (`backend: str`, `version: str`, `options: dict`).
  `PymupdfParser` reports `pymupdf` + `pymupdf.VersionBind`; `DoclingParser`
  reports `docling` + package version + the pipeline options it built
  (`do_ocr`, table mode, cell matching, device); `LlamaParseParser` reports
  `llamaparse` + tier + SDK version.
- **Fallback.** `FallbackDocumentParser.provenance` reports the parser that
  actually produced the blocks, plus `fallback_from` and the primary's error
  class, captured during `parse()`.
- **Schema.** One Alembic migration adds `article_files.parse_provenance JSONB
  NULL`. `DocumentParsingService` writes it in the same transaction and
  advisory lock as the blocks and `content_markdown`. Existing rows stay
  `NULL` (= unknown); no backfill guess.
- **Read.** Exposed on the article-file read schema (so MCP `get_article` and
  the UI can show it); regenerate `frontend/types/api`.
- **Comment drift.** `app/schemas/parser_settings.py` says `auto` falls back to
  Docling; it falls back to PyMuPDF. Fix in a sibling `refactor(parsing)` commit.

Tests: per-adapter `provenance` shape; fallback reports the fallback parser and
`fallback_from`; integration that a parse persists `parse_provenance`
atomically with blocks (a parser error leaves both unchanged).

## 3. Memory guard for Docling parses

Smallest change that makes an opt-in safe on the current worker, without a new
Railway service or image split (YAGNI while no project uses Docling):

- **One Docling parse at a time, fleet-wide.** `DoclingParser.parse` runs
  inside a Redis lock (`parsing:docling`, TTL = the task's hard limit, 660 s)
  on the existing Celery broker. Acquire blocks for up to 240 s; on timeout it
  raises a retryable error, so the task's existing retry path re-queues it.
  Peak worker RAM becomes ≈ one Docling parse + one ordinary child (~6.5 GB).
- **Return the memory.** `worker_max_memory_per_child` (Celery setting) at
  1.5 GB replaces a child after any task that left it above that, so torch's
  arena does not stay resident after a Docling parse. Ordinary children sit
  well below it (§1.1).
- **Converter singleton.** `DoclingParser` builds its `DocumentConverter` once
  per process (module-level cache keyed by the options tuple). Combined with
  the child replacement above, the cache lives only until that child recycles,
  which bounds the gain to repeated Docling parses in one child — accepted as
  small; it removes the per-call model load.
- PyMuPDF and LlamaParse paths are untouched.

Tests: the lock serializes two concurrent `DoclingParser.parse` calls (second
waits; times out into the retryable error when the hold exceeds the wait);
the lock is released when `parse` raises; the converter is built once across
two calls in one process.

## 4. Not done, and why

| Option | Why not now |
| --- | --- |
| Dedicated Railway `parser` service + `parsing` queue | Zero Docling projects; the lock bounds the risk at no ops cost. Revisit when a project opts in and parses wait on the lock. |
| Split images / drop torch from `web` | `web` RAM is unaffected (Docling is lazy-imported); only image size and deploy time would improve. Revisit with the service split. |
| Removing Docling | Ruled out by the 2026-10-19 decision (opt-in stays). |
| GPU serverless / managed parsers | Docling is opt-in at ~25 papers/month; LlamaParse already covers the managed tier. |
| OCR routing for scanned PDFs | Not measured by #1036; separate decision. |

## 5. Rollout

1. PR — §2 provenance (migration, port, fallback, read schema, type regen) +
   the sibling comment fix.
2. PR — §3 lock, `worker_max_memory_per_child`, converter singleton.
3. Promote with the normal release; after deploy, a parse writes non-null
   `parse_provenance` (check one new `article_files` row).

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Lock holder dies without release | TTL = hard limit (660 s); next acquire succeeds after it |
| A Docling backlog waits behind the lock | Bounded wait + retry; the backlog signal is the trigger for the service split in §4 |
| `worker_max_memory_per_child` recycles children too often | 1.5 GB is 3× the observed ordinary peak; check worker logs for recycle frequency after deploy |

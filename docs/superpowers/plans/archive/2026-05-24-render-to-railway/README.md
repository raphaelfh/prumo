---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Archived: 2026-05-24 Render → Railway migration

> **Status:** Shipped 2026-05-24. Frozen — do not edit.

This plan moved backend hosting from Render to Railway. Web (FastAPI + gunicorn),
Celery worker, and managed Redis on the Hobby plan, US East region.

For the **current architecture**, see [`docs/reference/deployment.md`](../../../../reference/deployment.md).

The `render.yaml` file referenced throughout the plan was deleted as part of the
Cleanup phase (E). No further action required.

"""Celery task-registration smoke test.

Guards against the regression where a new task module is created under
``app.worker.tasks.*`` but never added to ``celery_app.include``. When
that happens, the API process discovers the task at import time (the
endpoint imports the module directly) and ``task.delay(...)`` enqueues
fine, but the worker — which only imports modules listed in
``include=`` — never sees it and rejects the job as ``NotRegistered``.

The test runs as a *static* check against ``celery_app.conf.include``
rather than against the live ``celery_app.tasks`` registry: in the
pytest process ``conftest`` imports ``app.main``, which transitively
imports every endpoint, which imports every task module — so the
runtime registry is contaminated by side effects that a worker would
not see. Asserting on the literal ``include`` list captures the actual
worker contract.
"""

from __future__ import annotations

import pytest

from app.worker.celery_app import celery_app

# Each entry: (module that must be in ``include``, sample task it owns).
# The module is what protects the worker; the sample task documents the
# concrete symbol that breaks when the module is missing.
EXPECTED_TASK_MODULES = (
    ("app.worker.tasks.extraction_tasks", "extract_section_task"),
    ("app.worker.tasks.import_tasks", "import_zotero_collection_task"),
    ("app.worker.tasks.export_tasks", "export_articles_task"),
    ("app.worker.tasks.extraction_export_tasks", "export_extraction_task"),
)


@pytest.mark.parametrize(("module", "sample_task"), EXPECTED_TASK_MODULES)
def test_celery_module_is_included(module: str, sample_task: str) -> None:
    include = set(celery_app.conf.include or ())
    assert module in include, (
        f"{module!r} is missing from celery_app.conf.include — "
        f"the worker will reject {sample_task!r} as NotRegistered. "
        f"Add it to the include=[...] list in app/worker/celery_app.py."
    )

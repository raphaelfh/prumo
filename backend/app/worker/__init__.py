"""
Celery Worker.

Asynchronous processing of long-running tasks:
- Batch extractions
- Zotero imports
"""

from app.worker.celery_app import celery_app

__all__ = ["celery_app"]

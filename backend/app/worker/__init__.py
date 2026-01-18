"""
Celery Worker.

Processamento assíncrono de tarefas longas:
- Batch assessments
- Extrações em lote
- Importações do Zotero
"""

from app.worker.celery_app import celery_app

__all__ = ["celery_app"]

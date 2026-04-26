"""
Celery Worker.

Processamento assincrono de tarefas longas:
- Extracoes em lote
- Importacoes do Zotero
"""

from app.worker.celery_app import celery_app

__all__ = ["celery_app"]

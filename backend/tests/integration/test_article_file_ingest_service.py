from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.article_file_ingest_service import ArticleFileIngestService


def test_enqueue_parse_at_ingest_dispatches_task():
    af_id, project_id, user_id = uuid4(), uuid4(), str(uuid4())
    with patch("app.services.article_file_ingest_service.parse_article_file_task") as task:
        task.delay.return_value = MagicMock(id="task-123")
        task_id = ArticleFileIngestService().enqueue_parse_at_ingest(
            article_file_id=af_id,
            project_id=project_id,
            user_id=user_id,
            trace_id="t-1",
        )
    assert task_id == "task-123"
    task.delay.assert_called_once_with(
        article_file_id=str(af_id),
        project_id=str(project_id),
        user_id=user_id,
        trace_id="t-1",
    )

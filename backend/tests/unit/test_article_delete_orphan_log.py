"""`remove_article_objects` logs failed keys, at most 1000 per event."""

from unittest.mock import AsyncMock

from structlog.testing import capture_logs

from app.services.article_delete_service import remove_article_objects


async def test_failed_keys_are_logged_in_events_of_at_most_1000() -> None:
    keys = [f"p/{i}.pdf" for i in range(2500)]
    storage = AsyncMock()
    storage.delete_many.return_value = keys

    with capture_logs() as logs:
        failures = await remove_article_objects(storage, keys)

    events = [e for e in logs if e["event"] == "article_delete_storage_orphans"]
    assert failures == 2500
    assert [len(e["keys"]) for e in events] == [1000, 1000, 500]
    assert [k for e in events for k in e["keys"]] == keys


async def test_no_failure_logs_nothing() -> None:
    storage = AsyncMock()
    storage.delete_many.return_value = []

    with capture_logs() as logs:
        failures = await remove_article_objects(storage, ["p/a.pdf"])

    assert failures == 0
    assert not [e for e in logs if e["event"] == "article_delete_storage_orphans"]

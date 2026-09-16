from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.extraction_batch import CreateExtractionBatchRequest


def _body(ids: list) -> dict:
    return {"project_id": str(uuid4()), "template_id": str(uuid4()), "article_ids": ids}


def test_article_ids_are_deduplicated_in_order() -> None:
    a, b = uuid4(), uuid4()
    request = CreateExtractionBatchRequest.model_validate(_body([str(a), str(b), str(a)]))
    assert request.article_ids == [a, b]
    assert request.skip_articles_with_ai_suggestions is True


@pytest.mark.parametrize("count", [0, 101])
def test_article_count_outside_1_to_100_is_rejected(count: int) -> None:
    with pytest.raises(ValidationError):
        CreateExtractionBatchRequest.model_validate(_body([str(uuid4()) for _ in range(count)]))


def test_100_after_dedupe_is_accepted() -> None:
    ids = [str(uuid4()) for _ in range(100)]
    assert len(CreateExtractionBatchRequest.model_validate(_body(ids + ids[:5])).article_ids) == 100


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        CreateExtractionBatchRequest.model_validate(
            {**_body([str(uuid4())]), "owner_id": str(uuid4())}
        )

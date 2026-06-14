"""Pure validation tests for app.schemas.hitl_session."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.hitl_session import (
    CloneTemplateRequest,
    CloneTemplateResponse,
    OpenHITLSessionRequest,
    OpenHITLSessionResponse,
    UpdateTemplateActiveRequest,
    UpdateTemplateActiveResponse,
)


# --------------------------------------------------------------------------- #
# OpenHITLSessionRequest
# --------------------------------------------------------------------------- #
class TestOpenHITLSessionRequest:
    @staticmethod
    def _kwargs(**kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "kind": "extraction",
            "project_id": uuid4(),
            "article_id": uuid4(),
            "project_template_id": uuid4(),
        }
        base.update(kw)
        return base

    @pytest.mark.parametrize("kind", ["extraction", "quality_assessment"])
    def test_valid_kinds_accepted(self, kind: str) -> None:
        req = OpenHITLSessionRequest(**self._kwargs(kind=kind))
        assert req.kind == kind

    @pytest.mark.parametrize("kind", ["extract", "qa", "EXTRACTION", ""])
    def test_invalid_kind_rejected(self, kind: str) -> None:
        with pytest.raises(ValidationError):
            OpenHITLSessionRequest(**self._kwargs(kind=kind))

    def test_only_project_template_pointer_accepted(self) -> None:
        req = OpenHITLSessionRequest(**self._kwargs(global_template_id=None))
        assert req.project_template_id is not None
        assert req.global_template_id is None

    def test_only_global_template_pointer_accepted(self) -> None:
        gid = uuid4()
        req = OpenHITLSessionRequest(
            **self._kwargs(project_template_id=None, global_template_id=gid)
        )
        assert req.project_template_id is None
        assert req.global_template_id == gid

    def test_both_pointers_accepted(self) -> None:
        # The validator only forbids *neither* being set; both is allowed.
        req = OpenHITLSessionRequest(**self._kwargs(global_template_id=uuid4()))
        assert req.project_template_id is not None
        assert req.global_template_id is not None

    def test_no_template_pointer_rejected(self) -> None:
        with pytest.raises(ValidationError) as exc:
            OpenHITLSessionRequest(
                **self._kwargs(project_template_id=None, global_template_id=None)
            )
        assert "project_template_id or global_template_id" in str(exc.value)

    def test_missing_project_id_rejected(self) -> None:
        kwargs = self._kwargs()
        del kwargs["project_id"]
        with pytest.raises(ValidationError):
            OpenHITLSessionRequest(**kwargs)


# --------------------------------------------------------------------------- #
# OpenHITLSessionResponse
# --------------------------------------------------------------------------- #
class TestOpenHITLSessionResponse:
    @staticmethod
    def _kwargs(**kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "run_id": uuid4(),
            "kind": "extraction",
            "project_template_id": uuid4(),
            "instances_by_entity_type": {"et-1": "inst-1"},
        }
        base.update(kw)
        return base

    def test_valid_default_run_view_none(self) -> None:
        resp = OpenHITLSessionResponse(**self._kwargs())
        assert resp.run_view is None
        assert resp.instances_by_entity_type == {"et-1": "inst-1"}

    @pytest.mark.parametrize("kind", ["extraction", "quality_assessment"])
    def test_valid_kinds(self, kind: str) -> None:
        resp = OpenHITLSessionResponse(**self._kwargs(kind=kind))
        assert resp.kind == kind

    def test_invalid_kind_rejected(self) -> None:
        with pytest.raises(ValidationError):
            OpenHITLSessionResponse(**self._kwargs(kind="bogus"))

    def test_empty_instances_map_accepted(self) -> None:
        resp = OpenHITLSessionResponse(**self._kwargs(instances_by_entity_type={}))
        assert resp.instances_by_entity_type == {}

    def test_missing_run_id_rejected(self) -> None:
        kwargs = self._kwargs()
        del kwargs["run_id"]
        with pytest.raises(ValidationError):
            OpenHITLSessionResponse(**kwargs)


# --------------------------------------------------------------------------- #
# CloneTemplateRequest
# --------------------------------------------------------------------------- #
class TestCloneTemplateRequest:
    @pytest.mark.parametrize("kind", ["extraction", "quality_assessment"])
    def test_valid_kinds_accepted(self, kind: str) -> None:
        req = CloneTemplateRequest(global_template_id=uuid4(), kind=kind)
        assert req.kind == kind

    @pytest.mark.parametrize("kind", ["extract", "qa", "", "Extraction"])
    def test_invalid_kind_rejected(self, kind: str) -> None:
        with pytest.raises(ValidationError):
            CloneTemplateRequest(global_template_id=uuid4(), kind=kind)

    def test_missing_global_template_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CloneTemplateRequest(kind="extraction")  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# CloneTemplateResponse
# --------------------------------------------------------------------------- #
class TestCloneTemplateResponse:
    def test_valid_construction(self) -> None:
        resp = CloneTemplateResponse(
            project_template_id=uuid4(),
            version_id=uuid4(),
            entity_type_count=3,
            field_count=10,
            created=True,
        )
        assert resp.entity_type_count == 3
        assert resp.created is True

    def test_int_coercion_from_str(self) -> None:
        resp = CloneTemplateResponse(
            project_template_id=uuid4(),
            version_id=uuid4(),
            entity_type_count="2",  # type: ignore[arg-type]
            field_count="5",  # type: ignore[arg-type]
            created=False,
        )
        assert resp.entity_type_count == 2
        assert resp.field_count == 5

    def test_missing_created_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CloneTemplateResponse(  # type: ignore[call-arg]
                project_template_id=uuid4(),
                version_id=uuid4(),
                entity_type_count=1,
                field_count=1,
            )


# --------------------------------------------------------------------------- #
# UpdateTemplateActiveRequest
# --------------------------------------------------------------------------- #
class TestUpdateTemplateActiveRequest:
    def test_valid_true(self) -> None:
        assert UpdateTemplateActiveRequest(is_active=True).is_active is True

    def test_valid_false(self) -> None:
        assert UpdateTemplateActiveRequest(is_active=False).is_active is False

    def test_missing_is_active_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UpdateTemplateActiveRequest()  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# UpdateTemplateActiveResponse
# --------------------------------------------------------------------------- #
class TestUpdateTemplateActiveResponse:
    def test_valid_construction(self) -> None:
        tid = uuid4()
        resp = UpdateTemplateActiveResponse(project_template_id=tid, is_active=True)
        assert resp.project_template_id == tid
        assert resp.is_active is True

    def test_missing_fields_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UpdateTemplateActiveResponse(is_active=True)  # type: ignore[call-arg]

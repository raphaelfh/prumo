"""Validation tests for ``app.schemas.project``.

Pure Pydantic-v2 validation: no DB, no async, no fixtures. These cover
constraints, Literal/enum membership, defaults, and — most importantly —
the camelCase alias wire shape (``populate_by_name=True`` + ``by_alias``),
which is a recurring drift incident class in this repo.
"""

import types
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.project import (
    AddMemberRequest,
    MemberResponse,
    PICOTSConfig,
    ProjectCreate,
    ProjectListItem,
    ProjectListResponse,
    ProjectResponse,
    ProjectSettings,
    ProjectUpdate,
    TimingConfig,
    UpdateMemberRequest,
)

# =================== TimingConfig ===================


class TestTimingConfig:
    def test_defaults_are_empty_strings(self) -> None:
        cfg = TimingConfig()
        assert cfg.prediction_moment == ""
        assert cfg.prediction_horizon == ""

    def test_populate_by_snake_case_name(self) -> None:
        cfg = TimingConfig(prediction_moment="baseline", prediction_horizon="5y")
        assert cfg.prediction_moment == "baseline"
        assert cfg.prediction_horizon == "5y"

    def test_populate_by_camel_case_alias(self) -> None:
        cfg = TimingConfig(predictionMoment="baseline", predictionHorizon="5y")
        assert cfg.prediction_moment == "baseline"
        assert cfg.prediction_horizon == "5y"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = TimingConfig(prediction_moment="m", prediction_horizon="h").model_dump(by_alias=True)
        assert wire == {"predictionMoment": "m", "predictionHorizon": "h"}


# =================== PICOTSConfig ===================


class TestPICOTSConfig:
    def test_defaults(self) -> None:
        cfg = PICOTSConfig()
        assert cfg.population == ""
        assert cfg.index_models == ""
        assert cfg.comparator_models == ""
        assert cfg.outcomes == ""
        assert cfg.setting_and_intended_use == ""
        # timing built via default_factory
        assert isinstance(cfg.timing, TimingConfig)
        assert cfg.timing.prediction_moment == ""

    def test_populate_by_snake_case_name(self) -> None:
        cfg = PICOTSConfig(
            population="adults",
            index_models="model A",
            comparator_models="model B",
            outcomes="mortality",
            setting_and_intended_use="ICU",
        )
        assert cfg.index_models == "model A"
        assert cfg.comparator_models == "model B"
        assert cfg.setting_and_intended_use == "ICU"

    def test_populate_by_camel_case_alias(self) -> None:
        cfg = PICOTSConfig(
            population="adults",
            indexModels="model A",
            comparatorModels="model B",
            outcomes="mortality",
            settingAndIntendedUse="ICU",
            timing={"predictionMoment": "baseline"},
        )
        assert cfg.index_models == "model A"
        assert cfg.comparator_models == "model B"
        assert cfg.setting_and_intended_use == "ICU"
        assert cfg.timing.prediction_moment == "baseline"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = PICOTSConfig(
            index_models="A",
            comparator_models="B",
            setting_and_intended_use="ICU",
        ).model_dump(by_alias=True)
        assert wire["indexModels"] == "A"
        assert wire["comparatorModels"] == "B"
        assert wire["settingAndIntendedUse"] == "ICU"
        # nested model is also camelCased
        assert wire["timing"] == {"predictionMoment": "", "predictionHorizon": ""}


# =================== ProjectSettings ===================


class TestProjectSettings:
    def test_defaults(self) -> None:
        s = ProjectSettings()
        assert s.blind_mode is False
        assert s.require_dual_review is True
        assert s.auto_consensus is False

    def test_populate_by_snake_case_name(self) -> None:
        s = ProjectSettings(blind_mode=True, require_dual_review=False, auto_consensus=True)
        assert s.blind_mode is True
        assert s.require_dual_review is False
        assert s.auto_consensus is True

    def test_populate_by_camel_case_alias(self) -> None:
        s = ProjectSettings(blindMode=True, requireDualReview=False, autoConsensus=True)
        assert s.blind_mode is True
        assert s.require_dual_review is False
        assert s.auto_consensus is True

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ProjectSettings().model_dump(by_alias=True)
        assert wire == {
            "blindMode": False,
            "requireDualReview": True,
            "autoConsensus": False,
        }


# =================== ProjectCreate ===================


class TestProjectCreate:
    def test_minimal_valid_construction_and_defaults(self) -> None:
        p = ProjectCreate(name="My Review")
        assert p.name == "My Review"
        assert p.description is None
        assert p.review_keywords == []
        assert p.eligibility_criteria == {}
        assert p.study_design == {}
        assert p.review_type == "interventional"
        assert p.picots_config_ai_review is None
        assert isinstance(p.settings, ProjectSettings)
        assert p.settings.require_dual_review is True

    def test_name_min_length_boundary(self) -> None:
        # one char inside the lower bound is accepted
        assert ProjectCreate(name="a").name == "a"
        # empty string is below min_length=1
        with pytest.raises(ValidationError):
            ProjectCreate(name="")

    def test_name_max_length_boundary(self) -> None:
        assert ProjectCreate(name="a" * 255).name == "a" * 255
        with pytest.raises(ValidationError):
            ProjectCreate(name="a" * 256)

    def test_name_is_required(self) -> None:
        with pytest.raises(ValidationError):
            ProjectCreate()  # type: ignore[call-arg]

    def test_review_type_valid_member(self) -> None:
        for value in (
            "interventional",
            "predictive_model",
            "diagnostic",
            "prognostic",
            "qualitative",
            "other",
        ):
            assert ProjectCreate(name="x", review_type=value).review_type == value

    def test_review_type_invalid_member_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ProjectCreate(name="x", review_type="systematic")

    def test_populate_by_camel_case_aliases(self) -> None:
        p = ProjectCreate(
            name="x",
            reviewTitle="Title",
            conditionStudied="Cond",
            reviewRationale="Why",
            reviewContext="Ctx",
            searchStrategy="Strat",
            reviewKeywords=["k1", "k2"],
            eligibilityCriteria={"min_age": 18},
            studyDesign={"kind": "rct"},
            reviewType="diagnostic",
            picotsConfigAiReview={"population": "adults"},
        )
        assert p.review_title == "Title"
        assert p.condition_studied == "Cond"
        assert p.review_rationale == "Why"
        assert p.review_context == "Ctx"
        assert p.search_strategy == "Strat"
        assert p.review_keywords == ["k1", "k2"]
        assert p.eligibility_criteria == {"min_age": 18}
        assert p.study_design == {"kind": "rct"}
        assert p.review_type == "diagnostic"
        assert isinstance(p.picots_config_ai_review, PICOTSConfig)
        assert p.picots_config_ai_review.population == "adults"

    def test_populate_by_snake_case_names(self) -> None:
        p = ProjectCreate(
            name="x",
            review_title="Title",
            condition_studied="Cond",
            review_keywords=["k1"],
            review_type="prognostic",
        )
        assert p.review_title == "Title"
        assert p.condition_studied == "Cond"
        assert p.review_keywords == ["k1"]
        assert p.review_type == "prognostic"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ProjectCreate(name="x", review_title="T").model_dump(by_alias=True)
        assert wire["reviewTitle"] == "T"
        assert "reviewKeywords" in wire
        assert "eligibilityCriteria" in wire
        assert "studyDesign" in wire
        assert wire["reviewType"] == "interventional"
        assert "picotsConfigAiReview" in wire
        # nested settings model is camelCased too
        assert wire["settings"]["requireDualReview"] is True


# =================== ProjectUpdate ===================


class TestProjectUpdate:
    def test_all_fields_optional_empty_construction(self) -> None:
        u = ProjectUpdate()
        assert u.name is None
        assert u.description is None
        assert u.is_active is None
        assert u.review_keywords is None
        assert u.review_type is None
        assert u.settings is None

    def test_name_min_length_boundary(self) -> None:
        assert ProjectUpdate(name="a").name == "a"
        with pytest.raises(ValidationError):
            ProjectUpdate(name="")

    def test_name_max_length_boundary(self) -> None:
        assert ProjectUpdate(name="a" * 255).name == "a" * 255
        with pytest.raises(ValidationError):
            ProjectUpdate(name="a" * 256)

    def test_review_type_invalid_member_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ProjectUpdate(review_type="bogus")

    def test_populate_by_camel_case_aliases(self) -> None:
        u = ProjectUpdate(
            isActive=False,
            reviewTitle="T",
            conditionStudied="C",
            reviewKeywords=["k"],
            eligibilityCriteria={"a": 1},
            studyDesign={"b": 2},
            reviewType="qualitative",
        )
        assert u.is_active is False
        assert u.review_title == "T"
        assert u.condition_studied == "C"
        assert u.review_keywords == ["k"]
        assert u.eligibility_criteria == {"a": 1}
        assert u.study_design == {"b": 2}
        assert u.review_type == "qualitative"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ProjectUpdate(is_active=True, review_title="T").model_dump(by_alias=True)
        assert wire["isActive"] is True
        assert wire["reviewTitle"] == "T"


# =================== ProjectResponse ===================


def _project_response_attrs() -> types.SimpleNamespace:
    """A plain attribute object mimicking the ORM row for from_attributes."""
    now = datetime(2026, 6, 13, tzinfo=UTC)
    return types.SimpleNamespace(
        id=uuid4(),
        name="Proj",
        description=None,
        created_by_id=uuid4(),
        is_active=True,
        review_title=None,
        condition_studied=None,
        review_rationale=None,
        review_context=None,
        search_strategy=None,
        review_keywords=["k"],
        eligibility_criteria={"a": 1},
        study_design={"b": 2},
        review_type="interventional",
        picots_config_ai_review=None,
        settings={"blind_mode": False},
        created_at=now,
        updated_at=now,
        articles_count=3,
        members_count=2,
    )


class TestProjectResponse:
    def test_from_attributes(self) -> None:
        attrs = _project_response_attrs()
        resp = ProjectResponse.model_validate(attrs)
        assert resp.name == "Proj"
        assert resp.created_by_id == attrs.created_by_id
        assert resp.is_active is True
        assert resp.review_keywords == ["k"]
        assert resp.settings == {"blind_mode": False}
        assert resp.articles_count == 3
        assert resp.members_count == 2

    def test_dump_by_alias_emits_camel_case(self) -> None:
        resp = ProjectResponse.model_validate(_project_response_attrs())
        wire = resp.model_dump(by_alias=True)
        assert "createdById" in wire
        assert "isActive" in wire
        assert "reviewKeywords" in wire
        assert "eligibilityCriteria" in wire
        assert "studyDesign" in wire
        assert "reviewType" in wire
        assert "picotsConfigAiReview" in wire
        assert "createdAt" in wire
        assert "updatedAt" in wire
        assert "articlesCount" in wire
        assert "membersCount" in wire

    def test_optional_counters_default_none(self) -> None:
        attrs = _project_response_attrs()
        attrs.articles_count = None
        attrs.members_count = None
        resp = ProjectResponse.model_validate(attrs)
        assert resp.articles_count is None
        assert resp.members_count is None


# =================== AddMemberRequest ===================


class TestAddMemberRequest:
    def test_minimal_valid_construction_and_defaults(self) -> None:
        m = AddMemberRequest(email="alice@example.com")
        assert m.email == "alice@example.com"
        assert m.role == "reviewer"
        assert m.permissions == {"can_export": False}
        assert m.send_invitation is True

    def test_invalid_email_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AddMemberRequest(email="not-an-email")

    def test_role_valid_members(self) -> None:
        for role in ("manager", "reviewer", "viewer", "consensus"):
            assert AddMemberRequest(email="a@b.com", role=role).role == role

    def test_role_invalid_member_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AddMemberRequest(email="a@b.com", role="admin")

    def test_send_invitation_populate_by_alias(self) -> None:
        m = AddMemberRequest(email="a@b.com", sendInvitation=False)
        assert m.send_invitation is False

    def test_send_invitation_populate_by_name(self) -> None:
        m = AddMemberRequest(email="a@b.com", send_invitation=False)
        assert m.send_invitation is False

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = AddMemberRequest(email="a@b.com").model_dump(by_alias=True)
        assert "sendInvitation" in wire
        assert wire["sendInvitation"] is True


# =================== UpdateMemberRequest ===================


class TestUpdateMemberRequest:
    def test_empty_construction_defaults_none(self) -> None:
        u = UpdateMemberRequest()
        assert u.role is None
        assert u.permissions is None

    def test_role_valid_member(self) -> None:
        assert UpdateMemberRequest(role="manager").role == "manager"

    def test_role_invalid_member_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UpdateMemberRequest(role="superuser")

    def test_permissions_accepts_bool_dict(self) -> None:
        u = UpdateMemberRequest(permissions={"can_export": True})
        assert u.permissions == {"can_export": True}


# =================== MemberResponse ===================


def _member_response_attrs() -> types.SimpleNamespace:
    now = datetime(2026, 6, 13, tzinfo=UTC)
    return types.SimpleNamespace(
        id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        role="reviewer",
        permissions={"can_export": False},
        user_email="a@b.com",
        user_name="Alice",
        user_avatar=None,
        invitation_email=None,
        invitation_sent_at=None,
        invitation_accepted_at=None,
        created_at=now,
    )


class TestMemberResponse:
    def test_from_attributes(self) -> None:
        attrs = _member_response_attrs()
        m = MemberResponse.model_validate(attrs)
        assert m.project_id == attrs.project_id
        assert m.user_id == attrs.user_id
        assert m.role == "reviewer"
        assert m.user_email == "a@b.com"
        assert m.user_name == "Alice"

    def test_optional_invitation_fields_default_none(self) -> None:
        m = MemberResponse.model_validate(_member_response_attrs())
        assert m.invitation_email is None
        assert m.invitation_sent_at is None
        assert m.invitation_accepted_at is None
        assert m.user_avatar is None

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = MemberResponse.model_validate(_member_response_attrs()).model_dump(by_alias=True)
        for key in (
            "projectId",
            "userId",
            "userEmail",
            "userName",
            "userAvatar",
            "invitationEmail",
            "invitationSentAt",
            "invitationAcceptedAt",
            "createdAt",
        ):
            assert key in wire


# =================== ProjectListItem ===================


def _list_item_attrs() -> types.SimpleNamespace:
    now = datetime(2026, 6, 13, tzinfo=UTC)
    return types.SimpleNamespace(
        id=uuid4(),
        name="Proj",
        description=None,
        is_active=True,
        review_type="interventional",
        articles_count=5,
        members_count=2,
        my_role="manager",
        created_at=now,
        updated_at=now,
    )


class TestProjectListItem:
    def test_from_attributes(self) -> None:
        item = ProjectListItem.model_validate(_list_item_attrs())
        assert item.name == "Proj"
        assert item.is_active is True
        assert item.articles_count == 5
        assert item.members_count == 2
        assert item.my_role == "manager"

    def test_count_defaults(self) -> None:
        now = datetime(2026, 6, 13, tzinfo=UTC)
        item = ProjectListItem(
            id=uuid4(),
            name="Proj",
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        assert item.articles_count == 0
        assert item.members_count == 0
        assert item.my_role is None
        assert item.review_type == "interventional"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ProjectListItem.model_validate(_list_item_attrs()).model_dump(by_alias=True)
        for key in (
            "isActive",
            "reviewType",
            "articlesCount",
            "membersCount",
            "myRole",
            "createdAt",
            "updatedAt",
        ):
            assert key in wire


# =================== ProjectListResponse ===================


class TestProjectListResponse:
    def test_valid_construction_with_default_page(self) -> None:
        resp = ProjectListResponse(
            items=[],
            total=0,
            page_size=20,
            has_more=False,
        )
        assert resp.items == []
        assert resp.total == 0
        assert resp.page == 1  # documented default
        assert resp.page_size == 20
        assert resp.has_more is False

    def test_populate_by_camel_case_aliases(self) -> None:
        resp = ProjectListResponse(
            items=[],
            total=10,
            page=2,
            pageSize=5,
            hasMore=True,
        )
        assert resp.page == 2
        assert resp.page_size == 5
        assert resp.has_more is True

    def test_nested_items_validated(self) -> None:
        resp = ProjectListResponse(
            items=[_list_item_attrs().__dict__],
            total=1,
            page_size=20,
            has_more=False,
        )
        assert len(resp.items) == 1
        assert isinstance(resp.items[0], ProjectListItem)

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ProjectListResponse(
            items=[],
            total=0,
            page_size=20,
            has_more=False,
        ).model_dump(by_alias=True)
        assert "pageSize" in wire
        assert "hasMore" in wire

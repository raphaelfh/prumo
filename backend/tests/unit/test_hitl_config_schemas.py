"""Pure validation tests for app.schemas.hitl_config."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.hitl_config import (
    HitlConfigPayload,
    HitlConfigRead,
    HitlConfigUpdateResponse,
)


# --------------------------------------------------------------------------- #
# HitlConfigPayload
# --------------------------------------------------------------------------- #
class TestHitlConfigPayload:
    def test_valid_unanimous(self) -> None:
        payload = HitlConfigPayload(reviewer_count=1, consensus_rule="unanimous")
        assert payload.consensus_rule == "unanimous"
        assert payload.arbitrator_id is None

    def test_valid_majority(self) -> None:
        payload = HitlConfigPayload(reviewer_count=3, consensus_rule="majority")
        assert payload.consensus_rule == "majority"

    # --- reviewer_count boundaries (ge=1, le=20) --- #
    def test_reviewer_count_zero_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigPayload(reviewer_count=0, consensus_rule="unanimous")

    def test_reviewer_count_min_accepted(self) -> None:
        assert HitlConfigPayload(reviewer_count=1, consensus_rule="majority").reviewer_count == 1

    def test_reviewer_count_max_accepted(self) -> None:
        assert HitlConfigPayload(reviewer_count=20, consensus_rule="majority").reviewer_count == 20

    def test_reviewer_count_over_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigPayload(reviewer_count=21, consensus_rule="majority")

    def test_reviewer_count_negative_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigPayload(reviewer_count=-1, consensus_rule="majority")

    # --- consensus_rule literal --- #
    @pytest.mark.parametrize("rule", ["unanimous", "majority"])
    def test_non_arbitrator_rules_without_arbitrator_id(self, rule: str) -> None:
        payload = HitlConfigPayload(reviewer_count=2, consensus_rule=rule)
        assert payload.arbitrator_id is None

    def test_invalid_consensus_rule_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigPayload(reviewer_count=2, consensus_rule="dictator")

    # --- arbitrator cross-field validator --- #
    def test_arbitrator_rule_without_id_rejected(self) -> None:
        with pytest.raises(ValidationError) as exc:
            HitlConfigPayload(reviewer_count=2, consensus_rule="arbitrator")
        assert "arbitrator_id is required" in str(exc.value)

    def test_arbitrator_rule_with_id_accepted(self) -> None:
        aid = uuid4()
        payload = HitlConfigPayload(
            reviewer_count=2, consensus_rule="arbitrator", arbitrator_id=aid
        )
        assert payload.arbitrator_id == aid

    def test_arbitrator_id_ignored_for_non_arbitrator_rule(self) -> None:
        # Supplying arbitrator_id with a non-arbitrator rule is allowed.
        aid = uuid4()
        payload = HitlConfigPayload(reviewer_count=2, consensus_rule="majority", arbitrator_id=aid)
        assert payload.arbitrator_id == aid

    def test_missing_consensus_rule_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigPayload(reviewer_count=2)  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# HitlConfigRead
# --------------------------------------------------------------------------- #
class TestHitlConfigRead:
    @staticmethod
    def _kwargs(**kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "scope_kind": "project",
            "scope_id": uuid4(),
            "reviewer_count": 1,
            "consensus_rule": "unanimous",
            "arbitrator_id": None,
            "inherited": False,
        }
        base.update(kw)
        return base

    @pytest.mark.parametrize("scope", ["project", "template", "system_default"])
    def test_valid_scope_kinds(self, scope: str) -> None:
        read = HitlConfigRead(**self._kwargs(scope_kind=scope))
        assert read.scope_kind == scope

    def test_invalid_scope_kind_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigRead(**self._kwargs(scope_kind="global"))

    @pytest.mark.parametrize("rule", ["unanimous", "majority", "arbitrator"])
    def test_valid_consensus_rules(self, rule: str) -> None:
        # HitlConfigRead has no arbitrator cross-field validator; arbitrator
        # without id is a valid read shape.
        read = HitlConfigRead(**self._kwargs(consensus_rule=rule))
        assert read.consensus_rule == rule

    def test_invalid_consensus_rule_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigRead(**self._kwargs(consensus_rule="dictator"))

    def test_scope_id_none_accepted(self) -> None:
        read = HitlConfigRead(**self._kwargs(scope_kind="system_default", scope_id=None))
        assert read.scope_id is None

    def test_default_scope_id_is_none(self) -> None:
        kwargs = self._kwargs()
        del kwargs["scope_id"]
        read = HitlConfigRead(**kwargs)
        assert read.scope_id is None

    def test_default_arbitrator_id_is_none(self) -> None:
        kwargs = self._kwargs()
        del kwargs["arbitrator_id"]
        read = HitlConfigRead(**kwargs)
        assert read.arbitrator_id is None

    def test_missing_inherited_rejected(self) -> None:
        kwargs = self._kwargs()
        del kwargs["inherited"]
        with pytest.raises(ValidationError):
            HitlConfigRead(**kwargs)


# --------------------------------------------------------------------------- #
# HitlConfigUpdateResponse
# --------------------------------------------------------------------------- #
class TestHitlConfigUpdateResponse:
    def test_valid_construction(self) -> None:
        config = HitlConfigRead(
            scope_kind="template",
            scope_id=uuid4(),
            reviewer_count=2,
            consensus_rule="majority",
            arbitrator_id=None,
            inherited=True,
        )
        resp = HitlConfigUpdateResponse(config=config)
        assert resp.config.scope_kind == "template"
        assert resp.config.inherited is True

    def test_missing_config_rejected(self) -> None:
        with pytest.raises(ValidationError):
            HitlConfigUpdateResponse()  # type: ignore[call-arg]

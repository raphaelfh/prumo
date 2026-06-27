"""Integration test: ExtractionEvidence model column presence."""

from app.models.extraction import ExtractionEvidence


def test_evidence_has_attribution_label_column() -> None:
    assert "attribution_label" in ExtractionEvidence.__table__.columns

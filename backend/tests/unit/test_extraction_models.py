from app.models.extraction import ExtractionEvidence


def test_evidence_has_rank_column():
    cols = ExtractionEvidence.__table__.c
    assert "rank" in cols
    # A bare-string server_default's .arg is the string itself (no .text).
    assert cols["rank"].server_default.arg == "0"
    assert cols["rank"].nullable is False


def test_rank_default_backfills_legacy_rows_to_zero():
    # server_default "0" is what backfills pre-existing rows at migration time;
    # asserting it here is the backfill contract (SEED seeds no evidence; a raw
    # INSERT can't satisfy the FKs + workflow_target_present CHECK).
    assert ExtractionEvidence.__table__.c["rank"].server_default.arg == "0"

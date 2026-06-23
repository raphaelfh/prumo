"""Design-stability assertion (#9): AI extraction must leave the run in EXTRACT
so its proposals hydrate in the extract-stage form. Auto-advancing to CONSENSUS
here would skip extract-stage hydration and leave the form empty (the documented
`#bug`). Every stage advance in the extraction service therefore targets EXTRACT
(opening the run); none targets CONSENSUS/FINALIZED."""

import inspect
import re

from app.services import section_extraction_service


def test_extract_path_only_ever_targets_extract_stage():
    src = inspect.getsource(section_extraction_service)
    targets = set(re.findall(r"target_stage=ExtractionRunStage\.(\w+)", src))
    assert targets, "expected at least one advance_stage call to assert on"
    assert targets == {"EXTRACT"}, (
        f"the extract path must only advance to EXTRACT, but found {targets} — "
        "auto-advancing past EXTRACT breaks extract-stage proposal hydration (#bug)"
    )

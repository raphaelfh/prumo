"""Design-stability assertion (#9): AI extraction must leave the run in EXTRACT
so its proposals hydrate in the extract-stage form. Auto-advancing to CONSENSUS
here would skip extract-stage hydration and leave the form empty (the documented
`#bug`).

Since the one-live-run invariant (0045), run resolution lives in
``RunLifecycleService.resolve_or_create_extract_run`` — the extraction services
themselves perform NO stage advance at all, and the shared gate only ever
targets EXTRACT (opening/resuming the run)."""

import inspect
import re

from app.services import model_extraction_service, section_extraction_service
from app.services.run_lifecycle_service import RunLifecycleService

_TARGET_RE = r"target_stage=ExtractionRunStage\.(\w+)"


def test_extraction_services_never_advance_stages():
    for module in (section_extraction_service, model_extraction_service):
        src = inspect.getsource(module)
        targets = set(re.findall(_TARGET_RE, src))
        assert targets == set(), (
            f"{module.__name__} must not advance run stages (run resolution "
            f"belongs to the lifecycle gate), but found advances to {targets} — "
            "auto-advancing past EXTRACT breaks extract-stage proposal hydration (#bug)"
        )


def test_extract_gate_only_ever_targets_extract_stage():
    src = inspect.getsource(RunLifecycleService.resolve_or_create_extract_run)
    targets = set(re.findall(_TARGET_RE, src))
    assert targets == {"EXTRACT"}, (
        f"the extract gate must only advance to EXTRACT, but found {targets} — "
        "auto-advancing past EXTRACT breaks extract-stage proposal hydration (#bug)"
    )

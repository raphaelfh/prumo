"""Design-stability assertions over the AI-extraction package's source.

(#9) AI extraction must leave the run in EXTRACT so its proposals hydrate in
the extract-stage form. Auto-advancing to CONSENSUS here would skip
extract-stage hydration and leave the form empty (the documented ``#bug``).
Run resolution lives in ``CurrentRunResolver.resolve_or_create_extract``
— the extraction package performs NO stage advance, and the shared gate only
ever targets EXTRACT.

(§3, spec 2026-08-22) The assessor-owned exclusion is template-data-driven:
no module of the package branches on the run kind to decide what the model
sees. ``kind`` is an opaque pass-through, except where the prompt pair and the
verify pass are chosen (``_model_calls``).
"""

import inspect
import pkgutil
import re
from importlib import import_module

from app.services import ai_extraction
from app.services.current_run import CurrentRunResolver

_TARGET_RE = r"target_stage=ExtractionRunStage\.(\w+)"


def _modules() -> list:
    return [
        import_module(f"{ai_extraction.__name__}.{info.name}")
        for info in pkgutil.iter_modules(ai_extraction.__path__)
    ]


def _code(module) -> str:
    """Source with docstrings and comments stripped."""
    source = inspect.getsource(module)
    source = re.sub(r'("""|\'\'\')(?s:.*?)\1', "", source)
    return "\n".join(line.split("#", 1)[0] for line in source.splitlines())


def test_the_package_never_advances_stages():
    modules = _modules()
    assert len(modules) >= 5, "the guard must actually see the package's modules"
    for module in modules:
        targets = set(re.findall(_TARGET_RE, inspect.getsource(module)))
        assert targets == set(), (
            f"{module.__name__} must not advance run stages (run resolution "
            f"belongs to the lifecycle gate), but found advances to {targets} — "
            "auto-advancing past EXTRACT breaks extract-stage proposal hydration (#bug)"
        )


def test_extract_gate_only_ever_targets_extract_stage():
    src = inspect.getsource(CurrentRunResolver.resolve_or_create_extract)
    targets = set(re.findall(_TARGET_RE, src))
    assert targets == {"EXTRACT"}, (
        f"the extract gate must only advance to EXTRACT, but found {targets} — "
        "auto-advancing past EXTRACT breaks extract-stage proposal hydration (#bug)"
    )


def test_no_kind_branch_decides_what_the_model_sees():
    for module in _modules():
        if module.__name__.endswith("._model_calls"):
            continue  # chooses the prompt pair and skips verify for QA runs
        low = _code(module).lower()
        assert "quality_assessment" not in low, module.__name__
        assert 'kind != "extraction"' not in low, module.__name__
        assert 'kind == "extraction"' not in low, module.__name__
        assert "kind not in" not in low, module.__name__
        assert "templatekind" not in low, module.__name__

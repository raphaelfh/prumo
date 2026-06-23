import subprocess
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]

# The extraction pipeline files that previously hardcoded the model default.
# Other, unrelated LLM services (openai_service, ai_screening_service,
# pdf_metadata_extraction_service) keep their own model choices and are out of
# this task's scope.
EXTRACTION_FILES = [
    "app/schemas/extraction.py",
    "app/api/v1/endpoints/section_extraction.py",
    "app/api/v1/endpoints/model_extraction.py",
    "app/services/section_extraction_service.py",
    "app/services/model_extraction_service.py",
    "app/worker/tasks/extraction_tasks.py",
]


def test_extraction_pipeline_has_no_hardcoded_model_literal():
    """The extraction pipeline resolves the model from settings.LLM_DEFAULT_MODEL,
    never a hardcoded 'gpt-4o-mini' literal."""
    offending: list[str] = []
    for rel in EXTRACTION_FILES:
        out = subprocess.run(
            ["grep", "-In", "gpt-4o-mini", str(BACKEND / rel)],
            capture_output=True,
            text=True,
        ).stdout.strip()
        if out:
            offending.extend(f"{rel}:{ln}" for ln in out.splitlines())
    assert offending == [], "hardcoded model literals remain:\n" + "\n".join(offending)

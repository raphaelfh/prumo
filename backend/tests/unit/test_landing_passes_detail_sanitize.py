"""The landing keeps a snapshot's ``passes_detail``, reduced to its known keys."""

from app.schemas.llm_target import LlmTarget
from app.services.ai_extraction.landing import Generation

ENGINE = LlmTarget(provider="openai", model="gpt-5.6-luna")


def test_passes_detail_entries_keep_only_their_known_keys() -> None:
    entry = {
        "kind": "verify",
        "prompt_name": "verify_pass",
        "prompt_version": "abc123abc123",
        "tokens": {"prompt": 50, "completion": 5, "total": 55, "cached": 9},
        "request_ids": ["v1"],
        "raw_prompt": "never stored",
    }

    snapshot = Generation(ENGINE, {"passes_detail": [entry, "not an entry"]}, None).snapshot

    assert snapshot == {
        "passes_detail": [
            {
                "kind": "verify",
                "prompt_name": "verify_pass",
                "prompt_version": "abc123abc123",
                "tokens": {"prompt": 50, "completion": 5, "total": 55},
                "request_ids": ["v1"],
            }
        ]
    }

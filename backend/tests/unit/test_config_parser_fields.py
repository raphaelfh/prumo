from app.core.config import Settings


def test_parser_defaults():
    s = Settings()  # type: ignore[call-arg]
    assert s.PARSER_BACKEND == "pymupdf"  # free default; Docling is opt-in
    assert s.LLAMA_CLOUD_API_KEY is None  # cloud key optional (BYOK/global)

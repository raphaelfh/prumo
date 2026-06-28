from app.core.config import Settings


def test_parser_defaults():
    s = Settings()  # type: ignore[call-arg]
    assert s.PARSER_BACKEND == "pymupdf"  # free default; Docling is opt-in
    assert s.LLAMA_CLOUD_API_KEY is None  # cloud key optional (BYOK/global)
    # The LlamaParse SDK's parse() blocks up to its own default (7200s = 2h);
    # we cap it so a slow/stuck cloud job fails fast and the fallback engages.
    assert s.LLAMA_PARSE_TIMEOUT_SECONDS == 240.0

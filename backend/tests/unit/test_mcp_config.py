from app.core.config import Settings


def test_mcp_defaults_allow_loopback_and_the_test_host_only() -> None:
    s = Settings.model_construct()
    assert s.mcp_allowed_hosts == ["localhost:*", "127.0.0.1:*", "[::1]:*", "test"]
    assert s.mcp_allowed_origins == []  # no browser origin may call /mcp


def test_mcp_lists_are_trimmed_and_skip_blanks() -> None:
    s = Settings.model_construct(
        MCP_ALLOWED_HOSTS=" api.example , ,api.example:443 ",
        MCP_ALLOWED_ORIGINS="https://x.example,",
    )
    assert s.mcp_allowed_hosts == ["api.example", "api.example:443"]
    assert s.mcp_allowed_origins == ["https://x.example"]

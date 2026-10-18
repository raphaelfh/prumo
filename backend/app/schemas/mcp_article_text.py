"""Result models for `article_text_block_read_service.page_text_blocks`
(task 7a). Internal to the service/tool boundary: `get_article_text` is a
text-only tool (no `outputSchema`), so these models never reach the wire —
the tool renders them into the fixed-format text lines (spec §5.0/§5.1)."""

from __future__ import annotations

from pydantic import BaseModel


class McpTextChunk(BaseModel):
    page_number: int
    block_index: int
    char_offset: int
    text: str


class McpTextPage(BaseModel):
    chunks: list[McpTextChunk]
    next_cursor: str | None


def block_locator(page_number: int, block_index: int) -> str:
    """The bare block reference, ``p4·b123``: the body of every locator
    prefix below, and the ``get_extractions`` evidence locator, so an agent
    can match a quote's locator to the ``get_article_text`` line it came
    from."""
    return f"p{page_number}·b{block_index}"


def chunk_locator_prefix(page_number: int, block_index: int, char_offset: int) -> str:
    """The one locator-prefix format (spec §5.0): ``[p4·b123]``, or
    ``[p4·b123 cont.]`` for a chunk that resumes mid-block (``char_offset``
    > 0). Shared by the budget accounting in
    ``article_text_block_read_service.page_text_blocks`` and the tool's
    text rendering so the two never drift."""
    suffix = " cont." if char_offset else ""
    return f"[{block_locator(page_number, block_index)}{suffix}] "


def block_range_prefix(page_number: int, first: int, last: int) -> str:
    """The table form of ``chunk_locator_prefix``: ``[p3·b12–b18] `` (en
    dash) for a coalesced ``table_cell`` run on one page, first to last
    block index."""
    return f"[{block_locator(page_number, first)}–b{last}] "

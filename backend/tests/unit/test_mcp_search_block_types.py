"""The search tool's block-type literal mirrors the parser's closed vocabulary."""

from typing import get_args

from app.infrastructure.parsing.base import BLOCK_TYPES
from app.schemas.mcp_search import BlockTypeLiteral


def test_block_type_literal_matches_parser_vocabulary() -> None:
    assert set(get_args(BlockTypeLiteral)) == BLOCK_TYPES

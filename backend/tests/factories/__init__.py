"""Test factory fixtures for prumo integration tests.

Replaces ad-hoc raw-SQL inserts with typed, role-aware builders that go
through SQLAlchemy ORM. ORM-routed inserts also exercise the DB
constraints introduced in migration 0016 (CHECK + trigger), so fixture
misuse fails loud instead of silently producing inconsistent state.
"""

from .template_factory import TemplateFactory, make_entity_type

__all__ = ["TemplateFactory", "make_entity_type"]

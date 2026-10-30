"""No ORM column shares one mutable object as its default (no DB I/O).

A non-callable ``default={}`` is a single object: SQLAlchemy binds it on
every INSERT and copies that same object onto each flushed instance, so an
in-place edit on one row's value changes the column default for every later
row in the process (#94). Container defaults must be factories:
``default=dict``, ``default=list`` or a lambda.
"""

from app.models import Base

_MUTABLE = (dict, list, set)


def test_no_column_uses_a_shared_mutable_default() -> None:
    offenders = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.sorted_tables
        for column in table.columns
        if column.default is not None
        and column.default.is_scalar
        and isinstance(column.default.arg, _MUTABLE)
    ]
    assert offenders == []

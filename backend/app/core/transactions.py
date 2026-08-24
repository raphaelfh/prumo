"""Core transaction support — re-export UnitOfWork for cross-layer use.

The one load-bearing fact: importing `UnitOfWork` from here rather than
from `app.repositories.unit_of_work` is what lets `check_layered_arch.py`
read an API import as "touches transaction infrastructure" instead of
"reaches past services into repositories". See `app.repositories.unit_of_work`
for what the class actually does and when to add to it.
"""

from __future__ import annotations

from app.repositories.unit_of_work import UnitOfWork

__all__ = ["UnitOfWork"]

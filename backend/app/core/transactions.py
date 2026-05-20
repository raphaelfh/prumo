"""Core transaction support — re-export UnitOfWork for cross-layer use.

UnitOfWork is a transactional context manager that coordinates multi-repository
writes against the same AsyncSession. The implementation lives in
`app.repositories.unit_of_work` (close to the data-access layer it
manages), but the pattern is cross-cutting infrastructure — services
AND the API layer's bulk endpoints (articles_export, zotero_import)
use it to wrap a multi-step transaction without each layer having to
re-implement BEGIN/COMMIT/ROLLBACK boilerplate.

Importing `UnitOfWork` from `app.core.transactions` (rather than from
the repositories module directly) lets the layered-arch fitness check
distinguish "the API touches transaction infrastructure" (legitimate
cross-cutting concern) from "the API reaches past services into
repositories" (architectural smell). The former is the supported path;
the latter remains a check violation.
"""

from __future__ import annotations

from app.repositories.unit_of_work import UnitOfWork

__all__ = ["UnitOfWork"]

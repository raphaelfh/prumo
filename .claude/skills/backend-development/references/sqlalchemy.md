# SQLAlchemy 2.0 async patterns

The codebase is fully on the 2.0 declarative + async API. Anything you write should use `Mapped[T]` / `mapped_column` / `select()` and `await db.execute(...)`. See `backend/app/models/base.py` for `BaseModel` (`id`, timestamps, the Postgres ENUM type).

## Model anatomy

```python
from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class ExtractionProposalRecord(BaseModel):
    __tablename__ = "extraction_proposal_records"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("extraction_runs.id", ondelete="CASCADE"),
        index=True,
    )
    instance_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), index=True)
    field_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    source: Mapped[ExtractionProposalSource]  # PyEnum -> Postgres ENUM via PostgreSQLEnumType
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    __table_args__ = (
        UniqueConstraint("run_id", "instance_id", "field_id", "source", name="uq_proposal_natural_key"),
        Index("ix_proposal_run_field", "run_id", "field_id"),
        CheckConstraint("jsonb_typeof(payload) = 'object'", name="ck_proposal_payload_object"),
    )
```

Notes:
- `Mapped[T]` is mandatory in 2.0. `T | None` makes the column nullable; bare `T` makes it `NOT NULL`.
- `ondelete="CASCADE"` belongs in the FK declaration, not in a separate migration step.
- Indexes and constraints go in `__table_args__`. Inline `index=True` is fine for single-column indexes that aren't part of a constraint.
- Enums map via `PostgreSQLEnumType` — see `models/base.py` for the registry and how to add new ones.

## Relationships

```python
class ExtractionRun(BaseModel):
    __tablename__ = "extraction_runs"

    proposals: Mapped[list["ExtractionProposalRecord"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        lazy="raise",  # force explicit loading — no surprise N+1
    )

class ExtractionProposalRecord(BaseModel):
    run: Mapped["ExtractionRun"] = relationship(back_populates="proposals", lazy="raise")
```

`lazy="raise"` is the right default in an async codebase — implicit lazy load on a detached or async-bound instance raises `MissingGreenlet`. Force every load to be intentional via `selectinload` / `joinedload` / `await obj.awaitable_attrs.proposals`.

## Querying

`select()` is the only entry point. `db.query(...)` is removed in 2.0.

```python
from sqlalchemy import select
from sqlalchemy.orm import selectinload

stmt = (
    select(ExtractionRun)
    .where(
        ExtractionRun.project_id == project_id,
        ExtractionRun.article_id == article_id,
        ExtractionRun.stage != ExtractionRunStage.CANCELLED,
    )
    .options(selectinload(ExtractionRun.proposals))
    .order_by(ExtractionRun.created_at.desc())
    .limit(1)
)
run = (await db.execute(stmt)).scalar_one_or_none()
```

Patterns:
- `.scalar_one()` → must exist, else raises.
- `.scalar_one_or_none()` → may exist.
- `.scalars().all()` → list of model instances.
- `.all()` → list of `Row` tuples (when selecting multiple columns or aggregates).

## Loader strategy: when to use which

| Strategy | Best for | Cost |
|---|---|---|
| `selectinload(Parent.children)` | collections (one-to-many) | 1 extra query, no row duplication |
| `joinedload(Child.parent)` | scalar foreign keys (many-to-one) | 1 query, duplicates left-side rows if used on collections |
| `raiseload()` (default via `lazy="raise"`) | every relationship — force explicit | crashes loud on N+1 |
| `defer(Model.large_jsonb)` | rarely-needed huge columns | column not fetched until accessed |

Rule of thumb: collections → `selectinload`, scalars → `joinedload`. Reverse only when measurement says so.

## Locking — the row case

```python
stmt = (
    select(ExtractionRun)
    .where(ExtractionRun.id == run_id)
    .with_for_update()  # SELECT ... FOR UPDATE
)
run = (await db.execute(stmt)).scalar_one()
# now safe to mutate stage
```

`with_for_update(skip_locked=True)` for worker fan-out so two workers don't grab the same row. `with_for_update(nowait=True)` if you'd rather fail fast than wait.

## Locking — the cross-row case

For coordination that doesn't map cleanly to a single row (e.g. "only one HITL session opening for this `(project, article, template)` at a time"), use Postgres advisory locks scoped to the transaction:

```python
await db.execute(
    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
    {"key": f"{project_id}:{article_id}:{template_id}"},
)
```

See `services/hitl_session_service.py::_take_advisory_xact_lock`. The lock auto-releases on commit/rollback. Pair with idempotent writes — locks reduce racing, not duplication.

## Bulk inserts

```python
from sqlalchemy import insert
from sqlalchemy.dialects.postgresql import insert as pg_insert

stmt = pg_insert(ExtractionProposalRecord).values(rows)
stmt = stmt.on_conflict_do_nothing(
    index_elements=["run_id", "instance_id", "field_id", "source"]
)
await db.execute(stmt)
```

For idempotency, lean on `ON CONFLICT DO NOTHING` against a natural-key unique constraint rather than pre-querying. Saves a round trip and is race-free.

## Sessions and transactions

Default flow: `get_db` yields a session; a service operates on it; the request handler commits or rolls back. Don't commit inside the service — leave that to the boundary. If a service must commit (e.g. an idempotency write that must survive a later failure), open a `db.begin_nested()` and document why.

```python
async def open_or_resume(self) -> HITLSession:
    async with self.db.begin_nested():
        # SAVEPOINT — safe to roll back without losing prior work
        ...
```

## AsyncAttrs

`BaseModel` does not currently inherit `AsyncAttrs`, but if you need to lazy-load a relationship on a model instance outside an active session, use it:

```python
class BaseModel(AsyncAttrs, DeclarativeBase):
    ...

# later
proposals = await run.awaitable_attrs.proposals
```

Use sparingly — it's an escape hatch when refactoring legacy sync code, not a default.

## Raw SQL — when and how

Use `text(...)` with named parameters for:
- Calling SECURITY DEFINER helpers: `text("SELECT public.is_project_member(:pid, :uid)")`
- Advisory locks (above)
- Postgres-specific operators where the ORM gets clumsy (`@@`, `<@`, GIN containment)

Never interpolate values into the SQL string. Always bind via the parameters dict. SQL injection is real even on internal endpoints.

## Performance traps

- `selectinload` on a collection that returns 10k+ rows: split the parent query first, batch the children.
- `joinedload` on a one-to-many: explodes row count multiplicatively. Use `selectinload` instead.
- Forgetting `.scalars()` and getting `Row` objects when you wanted models — silent breakage downstream.
- Calling `await db.commit()` inside a service when the dependency will commit at the end. Double commits in async land cause subtle errors.

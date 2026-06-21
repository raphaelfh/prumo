# Schema drift (SQLAlchemy ↔ Pydantic ↔ TypeScript)

Schema drift = three sources of truth that disagree:

- **SQLAlchemy model** (`backend/app/models/*.py`) — what the DB enforces.
- **Pydantic schema** (`backend/app/schemas/*.py`) — what the API contract says.
- **TypeScript type** (frontend) — what the client expects.

When they drift, you get runtime errors that the type-checker missed, NULLs in fields the client treats as required, or required-on-DB fields the API forgets to demand.

## The four drift shapes

### 1. Optionality drift

```python
# Model
class Run(Base):
    started_at: Mapped[datetime] = mapped_column(nullable=True)  # NULL allowed

# Schema
class RunOut(BaseModel):
    started_at: datetime  # NOT optional — Pydantic will explode on a NULL row
```

Then a query returns a row where `started_at` is NULL and the API 500s. Or the inverse: `nullable=False` on the column, `Optional[X]` on the schema, frontend handles `null` everywhere unnecessarily.

**Rule:** the optionality of every field must match across all three layers. Grep both sides whenever you touch one.

### 2. Default drift

```python
# Model — DB-side default
class Foo(Base):
    flag: Mapped[bool] = mapped_column(server_default="false")

# Schema — also defaulted in Python
class FooIn(BaseModel):
    flag: bool = False
```

That's fine if both agree. The bug is when the model says `server_default="false"` and the schema says `flag: bool = True`, or when only one layer has a default and the other expects the field.

**Rule:** put the default in **one** layer, and only one. Prefer the DB (`server_default`) for canonical state, and require the field in the Pydantic input schema. Or default in Pydantic and let the column be NOT NULL with no DB default. Don't do both differently.

### 3. Enum drift

```python
# Model — DB enum
class RunStage(str, enum.Enum):
    PROPOSAL = "PROPOSAL"
    REVIEW = "REVIEW"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"
```

Now you add a new stage, say `BLOCKED`. You need to update:

- The Python enum.
- The DB enum type (Alembic migration with `ALTER TYPE ... ADD VALUE`).
- Every Pydantic schema referencing the enum.
- The frontend TypeScript union / enum.
- Any switch / if-elif that exhaustively handles the variants — they will now silently miss `BLOCKED`.

**Rule:** when adding/renaming an enum variant, grep all four places. Use exhaustive `match` or TS `never`-check to make the missing handler a type error.

### 4. Field rename / removal

A column rename is three migrations (rename, dual-write, drop) **and** API versioning if a client could be on the field's old name. On prumo we typically squash and break — but the PR must update the model, schema, hooks, components, tests, in the same commit.

**Rule:** rename = atomic PR. Don't ship a rename in pieces unless you have a deprecation path documented in the PR body.

## Audit checklist

For every PR that touches `backend/app/models/`:

- [ ] Open the matching `backend/app/schemas/*.py`. Diff the field set, types, optionality.
- [ ] Grep the frontend for the response type. Update the TS type if you renamed / added / removed fields.
- [ ] Run `make test-backend` — Pydantic will explode at deserialization time for many drifts.
- [ ] Run `npm run typecheck` — TS will catch the renamed/removed field consumers.

For every PR that adds a column:

- [ ] Is the column nullable? Match in Pydantic.
- [ ] Is there a DB default? If not, every insert path must supply the value — grep callers.
- [ ] Did the migration backfill existing rows? If `NOT NULL` with no default on an existing table, you must backfill.

For every PR that removes / renames a column:

- [ ] Drop the field from Pydantic + TS.
- [ ] Grep `frontend/` for the old name — there will be at least one usage you missed.
- [ ] Grep `backend/` for the old name in raw SQL strings (Alembic `op.execute(...)`).

## Audit greps

```sh
# Find fields that exist in models but not in schemas (rough — needs eyes)
diff <(grep -E "^\s+[a-z_]+:\s*Mapped" backend/app/models/<file>.py | sed -E 's/^.*: Mapped\[([^]]+)\].*/\1/') \
     <(grep -E "^\s+[a-z_]+:\s*" backend/app/schemas/<file>.py | head -50)

# Old field name still referenced after a rename
grep -Rn "old_field_name" backend/ frontend/

# Enum variants — list all references
grep -Rn "RunStage\." backend/ frontend/
```

## Test patterns

```python
def test_run_out_schema_round_trips(db_run_with_all_fields):
    out = RunOut.model_validate(db_run_with_all_fields)
    assert out.model_dump() == expected_dict
```

A round-trip test from a realistic DB row through the Pydantic schema catches optionality and default drift cheaply.

## Historical incidents

- Three of the 31 backend bugs in commit `1994ceb` were schema drift — fields nullable in the DB but not in Pydantic, causing 500s when the row had a NULL.
- The `extracted_values` → `extraction_published_states` rename round (migration 0002 + the frontend refactor) had to be atomic exactly because of drift risk; see `docs/reference/extraction-hitl-architecture.md`.

## Bottom line

Three layers, one shape. When you touch one, audit the other two. Use the type-checker as the last line of defense, not the only line.

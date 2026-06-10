# Pydantic v2 in prumo

All schemas live under `backend/app/schemas/`. The codebase is fully on v2 — no `@validator`, no `Config` class, no `.parse_obj`.

## Defaults to apply on every request schema

```python
from pydantic import BaseModel, ConfigDict


class CreateThing(BaseModel):
    model_config = ConfigDict(
        extra="forbid",       # reject unknown fields — anti mass-assignment
        str_strip_whitespace=True,
        validate_assignment=True,  # re-validate on attribute set (rare, but cheap)
    )
```

`extra="forbid"` is non-negotiable on request schemas. A request that includes fields the schema doesn't declare should fail loudly — that's how you catch frontend typos and prevent attackers from setting fields you didn't intend to expose.

## ORM → DTO

```python
return SomeResponse.model_validate(orm_instance, from_attributes=True)
```

`from_attributes=True` is the v2 spelling of v1's `orm_mode`. Add `model_config = ConfigDict(from_attributes=True)` on response schemas if every read path uses them — saves repeating the flag.

## Validators

```python
from pydantic import BaseModel, field_validator, model_validator


class OpenHITLSessionRequest(BaseModel):
    kind: Literal["extraction", "quality_assessment"]
    project_template_id: UUID | None = None
    global_template_id: UUID | None = None

    @field_validator("project_template_id", "global_template_id", mode="before")
    @classmethod
    def _empty_string_to_none(cls, v):
        # frontend sometimes sends "" — accept it as null
        return None if v == "" else v

    @model_validator(mode="after")
    def _exactly_one_pointer(self) -> "OpenHITLSessionRequest":
        match (self.project_template_id, self.global_template_id, self.kind):
            case (None, None, _):
                raise ValueError("project_template_id or global_template_id required")
            case (_, _, "extraction") if self.global_template_id is not None:
                raise ValueError("extraction does not use global_template_id")
        return self
```

- `mode="before"` validators run on raw input (good for coercion).
- `mode="after"` validators run on the constructed instance (good for cross-field rules).
- Mark `@classmethod` only on `field_validator`. `model_validator(mode="after")` runs as an instance method and returns `self`.
- Raise `ValueError` — Pydantic converts to a 422 with a structured detail.

## Literal vs Enum

| Use case | Pick |
|---|---|
| Closed set of choices in an API DTO | `Literal["a", "b"]` — serializes as plain strings, no enum machinery |
| Same set, but also a DB column | `PyEnum` for the model + `Literal` for the DTO, kept in sync |
| Cross-language consumed by typed clients | Either — Pydantic generates valid JSON Schema for both |

Don't import `PyEnum`s from `models/` into `schemas/`. That couples API surface to DB internals and makes future renames painful. Keep separate `Literal[...]` types, accept the duplication.

## Discriminated unions

Useful for kind-discriminated payloads (extraction vs quality_assessment):

```python
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field


class ExtractionPayload(BaseModel):
    kind: Literal["extraction"]
    project_template_id: UUID


class QAPayload(BaseModel):
    kind: Literal["quality_assessment"]
    global_template_id: UUID


SessionPayload = Annotated[
    Union[ExtractionPayload, QAPayload],
    Field(discriminator="kind"),
]
```

Pydantic uses `kind` to pick the right variant. Validation errors are scoped to the matching variant, which gives clean error messages.

## Partial updates (PATCH)

```python
class UpdateTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    is_active: bool | None = None

    def to_update_dict(self) -> dict:
        return self.model_dump(exclude_unset=True)
```

`exclude_unset=True` returns only the fields the client actually sent — never overwrite columns the client didn't touch with `None`.

## Settings — pydantic-settings

`app/core/config.py` uses `BaseSettings`:

```python
from pydantic import PostgresDsn, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    DEBUG: bool = False
    DATABASE_URL: PostgresDsn
    SUPABASE_JWT_SECRET: str
    OPENAI_API_KEY: str = Field(..., min_length=20)
```

Access via `from app.core.config import settings`. Don't call `os.getenv` from application code — `Settings` is the single typed source.

For module-scoped overrides in tests, `lru_cache`-ed factory + override the cache.

## Common pitfalls

- `BaseModel.model_dump_json()` returns a string; `.model_dump()` returns a dict. FastAPI handles serialization for you on responses — only call these manually for SSE / logging.
- `datetime` defaults: use `Field(default_factory=lambda: datetime.now(UTC))`. Bare `datetime.now()` evaluates at import time.
- Forward refs: if you need a self-referential type, declare with a string and call `Model.model_rebuild()` after the class body. v2 changed this from v1.
- Don't subclass response schemas to "extend" with more fields for a different endpoint — duplicate the schema. Subclassing leaks fields silently when the parent grows.

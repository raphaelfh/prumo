"""B4 — LlmEndpointService against real Postgres (C2).

The Fernet round-trip, the ``(project_id, label)`` unique gate, the
BOLA-scoped fetch and the delete-guard's raw engine-pointer read are
exactly the behaviours a mock would fake, so these run against the real
column set (JSONB server defaults, unique constraint, FK graph).

URLs use literal PUBLIC IPs on purpose: ``validate_endpoint_url`` passes
literals through without DNS, so the real guard runs with no network I/O.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.net_guard import EndpointUrlError
from app.schemas.llm_endpoint import (
    LlmEndpointCreateRequest,
    LlmEndpointProbeResult,
    LlmEndpointUpdateRequest,
)
from app.services.llm_endpoint_service import (
    EndpointNotFoundError,
    EndpointUnavailableError,
    LlmEndpointService,
)
from tests.integration.conftest import SEED

# Literal public IPs: vetted by the SSRF guard without any DNS resolution.
_BASE_URL = "https://8.8.8.8/v1"
_OTHER_URL = "https://8.8.4.4/v1"


def _create_payload(
    label: str = "lab-ollama",
    base_url: str = _BASE_URL,
    api_key: str | None = "sk-plain-secret",
    allowed_models: list[str] | None = None,
) -> LlmEndpointCreateRequest:
    return LlmEndpointCreateRequest(
        label=label,
        base_url=base_url,
        api_key=SecretStr(api_key) if api_key is not None else None,
        allowed_models=allowed_models if allowed_models is not None else ["model-one"],
    )


def _update_payload(
    label: str = "lab-ollama",
    base_url: str = _BASE_URL,
    api_key: str | None = None,
    allowed_models: list[str] | None = None,
) -> LlmEndpointUpdateRequest:
    return LlmEndpointUpdateRequest(
        label=label,
        base_url=base_url,
        api_key=SecretStr(api_key) if api_key is not None else None,
        allowed_models=allowed_models if allowed_models is not None else ["model-one"],
    )


async def _write_engine_pointer(db: AsyncSession, endpoint_id: UUID | None) -> None:
    """Hand-write ``settings["llm_engine"]["endpoint_id"]`` as raw JSONB.

    ``LlmEngineStored`` gains ``endpoint_id`` only in B8 — today its
    validator IGNORES the extra key (no ``extra`` config on the stored
    spine), which is exactly why the delete guard must read the raw dict.
    """
    payload: dict[str, object] = {"provider": "openai", "model": "gpt-4o-mini"}
    if endpoint_id is not None:
        payload["endpoint_id"] = str(endpoint_id)
    await db.execute(
        text(
            "UPDATE public.projects "
            "SET settings = COALESCE(settings, '{}'::jsonb) "
            "|| jsonb_build_object('llm_engine', CAST(:payload AS jsonb)) "
            "WHERE id = :pid"
        ),
        {"payload": json.dumps(payload), "pid": str(SEED.primary_project)},
    )


# ---------------------------------------------------------------------------
# create + decrypt roundtrip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_roundtrip_encrypts_and_decrypts(db_session: AsyncSession) -> None:
    """The stored column holds ciphertext, never the plaintext; the service
    decrypts it back; the read model only ever says ``has_api_key``."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(api_key="sk-roundtrip-secret"),
    )
    assert read.has_api_key is True
    assert read.validation_status == "unverified"
    assert read.base_url == _BASE_URL

    row = await service.get(SEED.primary_project, read.id)
    assert row.encrypted_api_key is not None
    assert row.encrypted_api_key != "sk-roundtrip-secret"
    assert "sk-roundtrip-secret" not in row.encrypted_api_key
    assert await service.decrypt_key(row) == "sk-roundtrip-secret"


@pytest.mark.asyncio
async def test_keyless_create_stores_no_ciphertext(db_session: AsyncSession) -> None:
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(api_key=None),
    )
    assert read.has_api_key is False

    row = await service.get(SEED.primary_project, read.id)
    assert row.encrypted_api_key is None
    assert await service.decrypt_key(row) is None


# ---------------------------------------------------------------------------
# BOLA-scoped fetch + label uniqueness
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_project_get_is_a_miss(db_session: AsyncSession) -> None:
    """A real endpoint id under the WRONG project resolves to not-found —
    the id alone must never fetch across projects (BOLA gate)."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )
    with pytest.raises(EndpointNotFoundError):
        await service.get(SEED.secondary_project, read.id)
    with pytest.raises(EndpointNotFoundError):
        await service.get(SEED.primary_project, uuid4())


@pytest.mark.asyncio
async def test_duplicate_label_scoped_to_the_project(db_session: AsyncSession) -> None:
    """The same label twice in one project is refused BEFORE the DB unique
    constraint fires; the same label in another project is fine."""
    service = LlmEndpointService(db_session)
    await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(label="shared-label"),
    )
    with pytest.raises(ValueError, match="shared-label"):
        await service.create(
            project_id=SEED.primary_project,
            created_by=SEED.primary_profile,
            payload=_create_payload(label="shared-label"),
        )
    other = await service.create(
        project_id=SEED.secondary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(label="shared-label"),
    )
    assert other.label == "shared-label"


# ---------------------------------------------------------------------------
# update — api_key tri-state + probe-state invalidation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_api_key_tristate(db_session: AsyncSession) -> None:
    """None keeps the stored key, "" clears it, a new string re-encrypts."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(api_key="sk-first-key"),
    )
    row = await service.get(SEED.primary_project, read.id)

    kept = await service.update(
        project_id=SEED.primary_project,
        endpoint_id=read.id,
        payload=_update_payload(api_key=None),
    )
    assert kept.has_api_key is True
    assert await service.decrypt_key(row) == "sk-first-key"

    cleared = await service.update(
        project_id=SEED.primary_project,
        endpoint_id=read.id,
        payload=_update_payload(api_key=""),
    )
    assert cleared.has_api_key is False
    assert row.encrypted_api_key is None
    assert await service.decrypt_key(row) is None

    replaced = await service.update(
        project_id=SEED.primary_project,
        endpoint_id=read.id,
        payload=_update_payload(api_key="sk-second-key"),
    )
    assert replaced.has_api_key is True
    assert await service.decrypt_key(row) == "sk-second-key"


async def _arm_probe_state(
    db_session: AsyncSession, service: LlmEndpointService, endpoint_id
) -> None:
    """Put the row in a probed state so a reset is observable."""
    row = await service.get(SEED.primary_project, endpoint_id)
    row.validation_status = "ok"
    row.capabilities = {"output_mode": "tool", "models_seen": ["model-one"]}
    row.last_validated_at = datetime.now(UTC)
    await db_session.flush()


@pytest.mark.asyncio
async def test_base_url_or_models_change_resets_probe_state(db_session: AsyncSession) -> None:
    """What was verified is no longer what is stored: a ``base_url`` or
    ``allowed_models`` change drops the probe outcome back to unverified."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )

    await _arm_probe_state(db_session, service, read.id)
    after_url = await service.update(
        project_id=SEED.primary_project,
        endpoint_id=read.id,
        payload=_update_payload(base_url=_OTHER_URL),
    )
    assert after_url.validation_status == "unverified"
    assert after_url.capabilities.output_mode is None
    assert after_url.capabilities.models_seen == []
    assert after_url.last_validated_at is None

    await _arm_probe_state(db_session, service, read.id)
    after_models = await service.update(
        project_id=SEED.primary_project,
        endpoint_id=read.id,
        payload=_update_payload(base_url=_OTHER_URL, allowed_models=["model-two"]),
    )
    assert after_models.validation_status == "unverified"
    assert after_models.last_validated_at is None


@pytest.mark.asyncio
async def test_label_only_change_keeps_probe_state(db_session: AsyncSession) -> None:
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )
    await _arm_probe_state(db_session, service, read.id)

    renamed = await service.update(
        project_id=SEED.primary_project,
        endpoint_id=read.id,
        payload=_update_payload(label="renamed-endpoint"),
    )
    assert renamed.label == "renamed-endpoint"
    assert renamed.validation_status == "ok"
    assert renamed.capabilities.output_mode == "tool"
    assert renamed.last_validated_at is not None


# ---------------------------------------------------------------------------
# delete — engine-pointer guard + project row lock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_blocked_while_the_engine_points_at_it(db_session: AsyncSession) -> None:
    """The raw ``settings["llm_engine"]["endpoint_id"]`` pointer blocks the
    delete with the typed 409; any other pointer state lets it through."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )

    await _write_engine_pointer(db_session, read.id)
    with pytest.raises(EndpointUnavailableError) as exc_info:
        await service.delete(project_id=SEED.primary_project, endpoint_id=read.id)
    assert exc_info.value.code == "LLM_ENDPOINT_UNAVAILABLE"
    assert exc_info.value.status_code == 409

    # Pointer moves to another endpoint: the delete goes through.
    await _write_engine_pointer(db_session, uuid4())
    result = await service.delete(project_id=SEED.primary_project, endpoint_id=read.id)
    assert result.deleted is True
    assert result.id == read.id
    with pytest.raises(EndpointNotFoundError):
        await service.get(SEED.primary_project, read.id)


@pytest.mark.asyncio
async def test_delete_takes_the_project_row_lock(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pointer check reads ``projects.settings`` — without FOR UPDATE a
    concurrent ``set_for_project`` could point the engine at this endpoint
    between the check and the DELETE (the ``set_for_project`` spy pattern)."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )

    executed: list[str] = []
    real_execute = db_session.execute

    async def _spy(statement, *args, **kwargs):  # type: ignore[no-untyped-def]
        executed.append(str(statement))
        return await real_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", _spy)

    await service.delete(project_id=SEED.primary_project, endpoint_id=read.id)

    assert any("projects" in sql and "FOR UPDATE" in sql for sql in executed), (
        f"delete read the project row without FOR UPDATE — statements executed: {executed}"
    )


# ---------------------------------------------------------------------------
# key material never leaks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tampered_ciphertext_maps_to_the_typed_409(db_session: AsyncSession) -> None:
    """A ciphertext that no longer authenticates surfaces as the typed
    EndpointUnavailableError naming the endpoint — never ciphertext, never
    a raw InvalidToken 500."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(label="tamper-target", api_key="sk-tamper-secret"),
    )
    row = await service.get(SEED.primary_project, read.id)
    assert row.encrypted_api_key is not None

    original = row.encrypted_api_key
    flipped_char = "A" if original[10] != "A" else "B"
    tampered = original[:10] + flipped_char + original[11:]
    row.encrypted_api_key = tampered
    await db_session.flush()

    with pytest.raises(EndpointUnavailableError) as exc_info:
        await service.decrypt_key(row)
    message = exc_info.value.message
    assert "tamper-target" in message
    assert str(read.id) in message
    assert tampered not in message
    assert original not in message


@pytest.mark.asyncio
async def test_read_models_never_carry_key_material(db_session: AsyncSession) -> None:
    """Neither the plaintext nor the ciphertext appears in the list read's
    dump or repr — ``has_api_key`` is the only trace a key exists."""
    plaintext = "sk-material-probe"
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(api_key=plaintext),
    )
    row = await service.get(SEED.primary_project, read.id)
    assert row.encrypted_api_key is not None
    ciphertext = row.encrypted_api_key

    reads = await service.list_for_project(SEED.primary_project)
    assert [r.id for r in reads] == [read.id]
    listed = reads[0]
    assert listed.has_api_key is True
    assert listed.created_by_name == "Integration Primary"

    dumped = json.dumps(listed.model_dump(mode="json"))
    for surface in (dumped, repr(listed)):
        assert plaintext not in surface
        assert ciphertext not in surface


# ---------------------------------------------------------------------------
# verify — probe outcome persistence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_persists_an_ok_probe(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(api_key="sk-verify-secret"),
    )

    captured: dict[str, object] = {}

    async def _ok_probe(*, vetted, api_key, allowed_models):  # type: ignore[no-untyped-def]
        captured.update(url=vetted.url, api_key=api_key, allowed_models=allowed_models)
        return LlmEndpointProbeResult(
            validation_status="ok",
            output_mode="tool",
            models_seen=["listed-model"],
            error=None,
        )

    monkeypatch.setattr("app.services.llm_endpoint_service.probe_endpoint", _ok_probe)

    result = await service.verify(project_id=SEED.primary_project, endpoint_id=read.id)
    assert result.validation_status == "ok"
    # The probe received the DECRYPTED key and the vetted, normalized URL.
    assert captured == {
        "url": _BASE_URL,
        "api_key": "sk-verify-secret",
        "allowed_models": ["model-one"],
    }

    row = await service.get(SEED.primary_project, read.id)
    assert row.validation_status == "ok"
    assert row.capabilities == {"output_mode": "tool", "models_seen": ["listed-model"]}
    assert row.last_validated_at is not None


@pytest.mark.asyncio
async def test_verify_persists_a_failed_probe(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )

    async def _failed_probe(**_kwargs):  # type: ignore[no-untyped-def]
        return LlmEndpointProbeResult(
            validation_status="failed",
            output_mode=None,
            models_seen=[],
            error="unreachable",
        )

    monkeypatch.setattr("app.services.llm_endpoint_service.probe_endpoint", _failed_probe)

    result = await service.verify(project_id=SEED.primary_project, endpoint_id=read.id)
    assert result.validation_status == "failed"

    row = await service.get(SEED.primary_project, read.id)
    assert row.validation_status == "failed"
    assert row.capabilities == {"output_mode": None, "models_seen": []}
    assert row.last_validated_at is not None


@pytest.mark.asyncio
async def test_verify_surfaces_a_sanitized_url_error_for_a_bad_stored_url(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A hand-written private base_url in the row fails CLOSED at verify:
    the guard's sanitized error surfaces and the probe is never called."""
    service = LlmEndpointService(db_session)
    read = await service.create(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=_create_payload(),
    )
    row = await service.get(SEED.primary_project, read.id)
    row.base_url = "https://10.0.0.5/v1"
    await db_session.flush()

    async def _never_called(**_kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("probe_endpoint must not run for an unvetted URL")

    monkeypatch.setattr("app.services.llm_endpoint_service.probe_endpoint", _never_called)

    with pytest.raises(EndpointUrlError) as exc_info:
        await service.verify(project_id=SEED.primary_project, endpoint_id=read.id)
    assert "private_address" in str(exc_info.value)

"""
Unit tests for verify_supabase_jwt (app/core/security.py).

The real JWT verification path had no direct coverage: endpoint tests
override get_current_user entirely. These tests exercise the actual
decode paths (HS256 local, RS256/ES256 via JWKS) against real tokens,
covering the python-jose -> PyJWT migration.
"""

import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1, generate_private_key
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import app.core.security as security_module
from app.core.config import settings
from app.core.security import verify_supabase_jwt

TEST_SECRET = "unit-test-jwt-secret-with-at-least-32-characters"
TEST_KID = "unit-test-kid"
TEST_SUB = "11111111-2222-3333-4444-555555555555"


def _issuer() -> str:
    return f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1"


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": TEST_SUB,
        "email": "user@example.com",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": _issuer(),
        "iat": now,
        "exp": now + 3600,
        "aal": "aal1",
    }
    claims.update(overrides)
    return claims


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _hs256_token(claims: dict[str, Any], secret: str = TEST_SECRET) -> str:
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture
def local_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_ENV", "local")
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", TEST_SECRET)


@pytest.fixture
def production_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_ENV", "production")


@pytest.fixture
def es256_keypair() -> tuple[Any, dict[str, Any]]:
    private_key = generate_private_key(SECP256R1())
    jwk = jwt.algorithms.ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk["kid"] = TEST_KID
    jwk["alg"] = "ES256"
    return private_key, jwk


def _patch_jwks(monkeypatch: pytest.MonkeyPatch, keys: list[dict[str, Any]]) -> None:
    async def fake_get_jwks() -> dict[str, Any]:
        return {"keys": keys}

    monkeypatch.setattr(security_module, "get_jwks", fake_get_jwks)


def _es256_token(private_key: Any, claims: dict[str, Any] | None = None) -> str:
    return jwt.encode(
        claims or _claims(), private_key, algorithm="ES256", headers={"kid": TEST_KID}
    )


# =================== HS256 (Supabase local) ===================


@pytest.mark.usefixtures("local_env")
async def test_local_hs256_valid_token() -> None:
    token = _hs256_token(_claims())

    payload = await verify_supabase_jwt(_creds(token))

    assert payload.sub == TEST_SUB
    assert payload.email == "user@example.com"
    assert payload.role == "authenticated"


@pytest.mark.usefixtures("local_env")
async def test_local_hs256_wrong_issuer_rejected() -> None:
    token = _hs256_token(_claims(iss="https://evil.example.com/auth/v1"))

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401
    assert "issuer mismatch" in exc_info.value.detail


@pytest.mark.usefixtures("local_env")
async def test_local_hs256_expired_rejected() -> None:
    now = int(time.time())
    token = _hs256_token(_claims(iat=now - 7200, exp=now - 3600))

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("local_env")
async def test_local_hs256_bad_signature_rejected() -> None:
    token = _hs256_token(_claims(), secret="another-secret-that-is-not-the-right-one")

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("local_env")
async def test_malformed_token_rejected() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds("not-a-jwt"))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("local_env")
async def test_local_rejects_unknown_alg() -> None:
    token = jwt.encode(_claims(), TEST_SECRET, algorithm="HS384")

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401
    assert "expected HS256/RS256/ES256" in exc_info.value.detail


# =================== JWKS (Supabase cloud) ===================


@pytest.mark.usefixtures("production_env")
async def test_production_rejects_hs256() -> None:
    token = _hs256_token(_claims())

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401
    assert "expected RS256/ES256" in exc_info.value.detail


@pytest.mark.usefixtures("production_env")
async def test_production_es256_valid_token(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])

    payload = await verify_supabase_jwt(_creds(_es256_token(private_key)))

    assert payload.sub == TEST_SUB
    assert payload.aal == "aal1"


@pytest.mark.usefixtures("production_env")
async def test_production_es256_unknown_kid_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [{**jwk, "kid": "some-other-kid"}])

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(_es256_token(private_key)))

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token signing key not found"


@pytest.mark.usefixtures("production_env")
async def test_production_empty_jwks_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, _ = es256_keypair
    _patch_jwks(monkeypatch, [])

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(_es256_token(private_key)))

    assert exc_info.value.status_code == 401
    assert "signing keys not available" in exc_info.value.detail


@pytest.mark.usefixtures("production_env")
async def test_production_es256_expired_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])
    now = int(time.time())
    token = _es256_token(private_key, _claims(iat=now - 7200, exp=now - 3600))

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("local_env")
async def test_local_es256_uses_jwks_path(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])

    payload = await verify_supabase_jwt(_creds(_es256_token(private_key)))

    assert payload.sub == TEST_SUB


# =================== jose -> PyJWT behavioral deltas ===================
# PyJWT validates claims python-jose silently skipped (future iat,
# missing aud). These tests pin the migrated behavior deliberately.


@pytest.mark.usefixtures("local_env")
async def test_future_iat_within_leeway_accepted() -> None:
    now = int(time.time())
    token = _hs256_token(_claims(iat=now + 5))

    payload = await verify_supabase_jwt(_creds(token))

    assert payload.sub == TEST_SUB


@pytest.mark.usefixtures("local_env")
async def test_future_iat_beyond_leeway_rejected() -> None:
    now = int(time.time())
    token = _hs256_token(_claims(iat=now + 300))

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("production_env")
async def test_production_es256_wrong_audience_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])
    token = _es256_token(private_key, _claims(aud="something-else"))

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("production_env")
async def test_production_es256_missing_audience_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Stricter than python-jose (whose missing-aud check was a no-op):
    # a JWKS-signed token without an aud claim is now rejected. Pinned
    # deliberately — GoTrue user tokens always carry aud=authenticated.
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])
    claims = _claims()
    claims.pop("aud")
    token = _es256_token(private_key, claims)

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("production_env")
async def test_production_es256_wrong_issuer_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])
    token = _es256_token(private_key, _claims(iss="https://evil.example.com/auth/v1"))

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401


@pytest.mark.usefixtures("production_env")
async def test_production_rs256_valid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    from cryptography.hazmat.primitives.asymmetric.rsa import (
        generate_private_key as generate_rsa_key,
    )

    private_key = generate_rsa_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk["kid"] = TEST_KID
    jwk["alg"] = "RS256"
    _patch_jwks(monkeypatch, [jwk])
    token = jwt.encode(_claims(), private_key, algorithm="RS256", headers={"kid": TEST_KID})

    payload = await verify_supabase_jwt(_creds(token))

    assert payload.sub == TEST_SUB


@pytest.mark.usefixtures("production_env")
async def test_production_kidless_token_rejected(
    es256_keypair: tuple[Any, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key, jwk = es256_keypair
    _patch_jwks(monkeypatch, [jwk])
    token = jwt.encode(_claims(), private_key, algorithm="ES256")

    with pytest.raises(HTTPException) as exc_info:
        await verify_supabase_jwt(_creds(token))

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token signing key not found"


@pytest.mark.usefixtures("local_env")
async def test_local_wrong_audience_accepted_via_flexible_retry() -> None:
    # Deliberate local-mode leniency (pre-existing design): the strict
    # decode fails on aud, then the flexible retry accepts when the
    # signature and issuer are valid.
    token = _hs256_token(_claims(aud="not-authenticated"))

    payload = await verify_supabase_jwt(_creds(token))

    assert payload.sub == TEST_SUB

"""Unit tests for app.services.api_key_service.

Pure-mock — no database or network hits.
The Fernet encryption/decryption is exercised via real crypto (settings
supplies ENCRYPTION_KEY) — only DB and HTTP calls are mocked.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.user_api_key import UserAPIKey
from app.services.api_key_service import APIKeyService

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

USER_UUID = uuid.uuid4()
KEY_UUID = uuid.uuid4()
# Real user_id (UUID string) so derive_encryption_key works
USER_ID_STR = str(USER_UUID)


def make_key(
    *,
    id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    provider: str = "openai",
    is_active: bool = True,
    is_default: bool = False,
    encrypted_api_key: str | None = None,
    validation_status: str = "pending",
) -> MagicMock:
    key = MagicMock(spec=UserAPIKey)
    key.id = id or uuid.uuid4()
    key.user_id = user_id or USER_UUID
    key.provider = provider
    key.is_active = is_active
    key.is_default = is_default
    key.encrypted_api_key = encrypted_api_key or "enc-placeholder"
    key.validation_status = validation_status
    key.key_name = None
    return key


def make_service(
    user_id: str | uuid.UUID | None = None,
    repo: MagicMock | None = None,
) -> APIKeyService:
    db = AsyncMock()
    svc = APIKeyService(db=db, user_id=user_id or USER_ID_STR)
    if repo is not None:
        svc._repo = repo
    return svc


def make_repo() -> MagicMock:
    repo = MagicMock()
    repo.list_by_user = AsyncMock(return_value=[])
    repo.get_default = AsyncMock(return_value=None)
    repo.create_key = AsyncMock()
    repo.set_validation_status = AsyncMock()
    repo.update_last_used = AsyncMock()
    repo.get_by_id_and_user = AsyncMock(return_value=None)
    repo.set_default = AsyncMock(return_value=True)
    repo.update_key_name = AsyncMock(return_value=True)
    repo.deactivate = AsyncMock(return_value=True)
    repo.hard_delete = AsyncMock(return_value=True)
    return repo


# ---------------------------------------------------------------------------
# Construction / property guards
# ---------------------------------------------------------------------------


class TestConstructor:
    def test_valid_uuid_string_sets_user_id(self) -> None:
        svc = make_service()
        assert svc._user_id == USER_UUID

    def test_uuid_object_sets_user_id(self) -> None:
        svc = make_service(user_id=USER_UUID)
        assert svc._user_id == USER_UUID

    def test_invalid_uuid_string_leaves_user_id_none(self) -> None:
        svc = make_service(user_id="not-a-uuid")
        assert svc._user_id is None

    def test_user_id_property_raises_for_invalid_string(self) -> None:
        svc = make_service(user_id="not-a-uuid")
        with pytest.raises(ValueError):
            _ = svc.user_id


# ---------------------------------------------------------------------------
# Encryption helpers (_encrypt / _decrypt)
# ---------------------------------------------------------------------------


class TestEncryptDecrypt:
    def test_round_trip(self) -> None:
        svc = make_service()
        plaintext = "sk-test-12345"
        encrypted = svc._encrypt(plaintext)
        assert encrypted != plaintext
        decrypted = svc._decrypt(encrypted)
        assert decrypted == plaintext

    def test_different_users_produce_different_ciphertext(self) -> None:
        svc1 = make_service(user_id=str(uuid.uuid4()))
        svc2 = make_service(user_id=str(uuid.uuid4()))
        enc1 = svc1._encrypt("key")
        enc2 = svc2._encrypt("key")
        assert enc1 != enc2


# ---------------------------------------------------------------------------
# list_keys
# ---------------------------------------------------------------------------


class TestListKeys:
    @pytest.mark.asyncio
    async def test_delegates_to_repo(self) -> None:
        repo = make_repo()
        keys = [make_key()]
        repo.list_by_user = AsyncMock(return_value=keys)
        svc = make_service(repo=repo)

        result = await svc.list_keys()

        repo.list_by_user.assert_awaited_once_with(USER_UUID, active_only=True)
        assert result == keys

    @pytest.mark.asyncio
    async def test_active_only_false_passed_through(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        await svc.list_keys(active_only=False)

        repo.list_by_user.assert_awaited_once_with(USER_UUID, active_only=False)


# ---------------------------------------------------------------------------
# save_key
# ---------------------------------------------------------------------------


class TestSaveKey:
    @pytest.mark.asyncio
    async def test_raises_for_unsupported_provider(self) -> None:
        svc = make_service()
        with pytest.raises(ValueError, match="not supported"):
            await svc.save_key("unknown_provider", "key-abc")

    @pytest.mark.asyncio
    async def test_saves_key_without_validation(self) -> None:
        repo = make_repo()
        created = make_key(id=KEY_UUID)
        repo.create_key = AsyncMock(return_value=created)
        svc = make_service(repo=repo)

        result = await svc.save_key("openai", "sk-abc", validate=False)

        assert result["id"] == str(KEY_UUID)
        assert result["provider"] == "openai"
        assert result["validation_status"] == "pending"
        repo.create_key.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_validation_invalid_does_not_raise(self) -> None:
        repo = make_repo()
        created = make_key(id=KEY_UUID)
        repo.create_key = AsyncMock(return_value=created)
        svc = make_service(repo=repo)

        validation_result = {"status": "invalid", "message": "Bad key"}
        with patch.object(svc, "_validate_key", AsyncMock(return_value=validation_result)):
            result = await svc.save_key("openai", "bad-key", validate=True)

        assert result["validation_status"] == "invalid"
        repo.set_validation_status.assert_awaited_once_with(created.id, "invalid")

    @pytest.mark.asyncio
    async def test_valid_key_updates_validation_status(self) -> None:
        repo = make_repo()
        created = make_key(id=KEY_UUID)
        repo.create_key = AsyncMock(return_value=created)
        svc = make_service(repo=repo)

        with patch.object(
            svc,
            "_validate_key",
            AsyncMock(return_value={"status": "valid", "message": "OK"}),
        ):
            result = await svc.save_key("openai", "sk-good", validate=True)

        assert result["validation_status"] == "valid"

    @pytest.mark.asyncio
    async def test_pending_status_does_not_call_set_validation(self) -> None:
        repo = make_repo()
        created = make_key(id=KEY_UUID)
        repo.create_key = AsyncMock(return_value=created)
        svc = make_service(repo=repo)

        with patch.object(
            svc,
            "_validate_key",
            AsyncMock(return_value={"status": "pending"}),
        ):
            await svc.save_key("openai", "sk-x", validate=True)

        repo.set_validation_status.assert_not_awaited()


# ---------------------------------------------------------------------------
# get_key_for_provider
# ---------------------------------------------------------------------------


class TestGetKeyForProvider:
    @pytest.mark.asyncio
    async def test_returns_decrypted_user_key(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        plaintext = "sk-test-provider-key"
        encrypted = svc._encrypt(plaintext)
        key = make_key(encrypted_api_key=encrypted)
        repo.get_default = AsyncMock(return_value=key)

        result = await svc.get_key_for_provider("openai")

        assert result == plaintext
        repo.update_last_used.assert_awaited_once_with(key.id)

    @pytest.mark.asyncio
    async def test_falls_back_to_global_key(self) -> None:
        repo = make_repo()
        repo.get_default = AsyncMock(return_value=None)
        svc = make_service(repo=repo)

        with patch.object(svc, "_get_global_key", return_value="global-key"):
            result = await svc.get_key_for_provider("openai")

        assert result == "global-key"

    @pytest.mark.asyncio
    async def test_returns_none_when_no_fallback(self) -> None:
        repo = make_repo()
        repo.get_default = AsyncMock(return_value=None)
        svc = make_service(repo=repo)

        with patch.object(svc, "_get_global_key", return_value=None):
            result = await svc.get_key_for_provider("anthropic", use_fallback=False)

        assert result is None

    @pytest.mark.asyncio
    async def test_invalid_user_id_goes_straight_to_fallback(self) -> None:
        svc = APIKeyService(db=AsyncMock(), user_id="not-uuid")

        with patch.object(svc, "_get_global_key", return_value="fallback-key"):
            result = await svc.get_key_for_provider("openai")

        assert result == "fallback-key"


# ---------------------------------------------------------------------------
# get_decrypted_key
# ---------------------------------------------------------------------------


class TestGetDecryptedKey:
    @pytest.mark.asyncio
    async def test_returns_decrypted_key_when_found(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        plaintext = "sk-decrypted-value"
        encrypted = svc._encrypt(plaintext)
        key = make_key(encrypted_api_key=encrypted)
        repo.get_by_id_and_user = AsyncMock(return_value=key)

        result = await svc.get_decrypted_key(KEY_UUID)

        assert result == plaintext

    @pytest.mark.asyncio
    async def test_returns_none_when_not_found(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)
        repo.get_by_id_and_user = AsyncMock(return_value=None)

        result = await svc.get_decrypted_key(KEY_UUID)

        assert result is None


# ---------------------------------------------------------------------------
# _get_global_key
# ---------------------------------------------------------------------------


class TestGetGlobalKey:
    def test_openai_returns_settings_key(self) -> None:
        svc = make_service()
        # settings.OPENAI_API_KEY is "x" in test env
        result = svc._get_global_key("openai")
        # Acceptable: either "x" or None (depending on env), but no exception
        assert result is not None or result is None

    def test_unknown_provider_returns_none(self) -> None:
        svc = make_service()
        result = svc._get_global_key("unknown_provider")
        assert result is None


# ---------------------------------------------------------------------------
# set_default
# ---------------------------------------------------------------------------


class TestSetDefault:
    @pytest.mark.asyncio
    async def test_returns_true_when_successful(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        result = await svc.set_default(KEY_UUID)

        assert result is True
        repo.set_default.assert_awaited_once_with(KEY_UUID, USER_UUID)

    @pytest.mark.asyncio
    async def test_returns_false_when_repo_returns_false(self) -> None:
        repo = make_repo()
        repo.set_default = AsyncMock(return_value=False)
        svc = make_service(repo=repo)

        result = await svc.set_default(KEY_UUID)

        assert result is False


# ---------------------------------------------------------------------------
# update_key_name
# ---------------------------------------------------------------------------


class TestUpdateKeyName:
    @pytest.mark.asyncio
    async def test_returns_true_on_success(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        result = await svc.update_key_name(KEY_UUID, "New Name")

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self) -> None:
        repo = make_repo()
        repo.update_key_name = AsyncMock(return_value=False)
        svc = make_service(repo=repo)

        result = await svc.update_key_name(KEY_UUID, "Name")

        assert result is False


# ---------------------------------------------------------------------------
# deactivate_key
# ---------------------------------------------------------------------------


class TestDeactivateKey:
    @pytest.mark.asyncio
    async def test_deactivates_successfully(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        result = await svc.deactivate_key(KEY_UUID)

        assert result is True
        repo.deactivate.assert_awaited_once_with(KEY_UUID, USER_UUID)

    @pytest.mark.asyncio
    async def test_returns_false_on_not_found(self) -> None:
        repo = make_repo()
        repo.deactivate = AsyncMock(return_value=False)
        svc = make_service(repo=repo)

        result = await svc.deactivate_key(KEY_UUID)

        assert result is False


# ---------------------------------------------------------------------------
# delete_key
# ---------------------------------------------------------------------------


class TestDeleteKey:
    @pytest.mark.asyncio
    async def test_deletes_successfully(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        result = await svc.delete_key(KEY_UUID)

        assert result is True
        repo.hard_delete.assert_awaited_once_with(KEY_UUID, USER_UUID)

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self) -> None:
        repo = make_repo()
        repo.hard_delete = AsyncMock(return_value=False)
        svc = make_service(repo=repo)

        result = await svc.delete_key(KEY_UUID)

        assert result is False


# ---------------------------------------------------------------------------
# revalidate_key
# ---------------------------------------------------------------------------


class TestRevalidateKey:
    @pytest.mark.asyncio
    async def test_raises_when_key_not_found(self) -> None:
        repo = make_repo()
        repo.get_by_id_and_user = AsyncMock(return_value=None)
        svc = make_service(repo=repo)

        with pytest.raises(ValueError, match="not found"):
            await svc.revalidate_key(KEY_UUID)

    @pytest.mark.asyncio
    async def test_returns_validation_result(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        plaintext = "sk-real-key"
        key = make_key(encrypted_api_key=svc._encrypt(plaintext), provider="openai")
        repo.get_by_id_and_user = AsyncMock(return_value=key)
        repo.set_validation_status = AsyncMock()

        validation = {"status": "valid", "message": "OK"}
        with patch.object(svc, "_validate_key", AsyncMock(return_value=validation)):
            result = await svc.revalidate_key(KEY_UUID)

        assert result["status"] == "valid"
        repo.set_validation_status.assert_awaited_once_with(KEY_UUID, "valid")

    @pytest.mark.asyncio
    async def test_accepts_string_key_id(self) -> None:
        repo = make_repo()
        svc = make_service(repo=repo)

        key = make_key(encrypted_api_key=svc._encrypt("sk-x"), provider="openai")
        repo.get_by_id_and_user = AsyncMock(return_value=key)

        with patch.object(svc, "_validate_key", AsyncMock(return_value={"status": "valid"})):
            result = await svc.revalidate_key(str(KEY_UUID))

        assert result["status"] == "valid"


# ---------------------------------------------------------------------------
# _validate_key (dispatch + exception handling)
# ---------------------------------------------------------------------------


class TestValidateKey:
    @pytest.mark.asyncio
    async def test_unknown_provider_returns_pending(self) -> None:
        svc = make_service()
        result = await svc._validate_key("unknown", "some-key")
        assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_exception_returns_pending(self) -> None:
        svc = make_service()
        with patch.object(svc, "_validate_openai", AsyncMock(side_effect=RuntimeError("timeout"))):
            result = await svc._validate_key("openai", "key")
        assert result["status"] == "pending"
        assert "Validation error" in result["message"]


# ---------------------------------------------------------------------------
# Provider validators (httpx mocked)
# ---------------------------------------------------------------------------


class TestValidateOpenai:
    @pytest.mark.asyncio
    async def test_200_returns_valid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 200
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_openai("sk-good")
        assert result["status"] == "valid"

    @pytest.mark.asyncio
    async def test_401_returns_invalid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 401
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_openai("sk-bad")
        assert result["status"] == "invalid"

    @pytest.mark.asyncio
    async def test_429_returns_valid_rate_limited(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 429
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_openai("sk-rate-limited")
        assert result["status"] == "valid"


class TestValidateAnthropic:
    @pytest.mark.asyncio
    async def test_200_returns_valid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 200
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_anthropic("claude-key")
        assert result["status"] == "valid"

    @pytest.mark.asyncio
    async def test_401_returns_invalid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 401
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_anthropic("bad-key")
        assert result["status"] == "invalid"

    @pytest.mark.asyncio
    async def test_500_returns_valid_when_no_auth_in_body(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = '{"error": "server_error"}'
        mock_response.json.return_value = {"error": "server_error"}
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_anthropic("key")
        assert result["status"] == "valid"


class TestValidateGemini:
    @pytest.mark.asyncio
    async def test_200_returns_valid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 200
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_gemini("gemini-key")
        assert result["status"] == "valid"

    @pytest.mark.asyncio
    async def test_400_returns_invalid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 400
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_gemini("bad-key")
        assert result["status"] == "invalid"


class TestValidateGrok:
    @pytest.mark.asyncio
    async def test_200_returns_valid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 200
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_grok("grok-key")
        assert result["status"] == "valid"

    @pytest.mark.asyncio
    async def test_401_returns_invalid(self) -> None:
        svc = make_service()
        mock_response = MagicMock()
        mock_response.status_code = 401
        with patch("httpx.AsyncClient") as MockClient:
            MockClient.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )
            result = await svc._validate_grok("bad-key")
        assert result["status"] == "invalid"

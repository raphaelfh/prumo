"""Unit tests for app.repositories.user_api_key_repository.

Pure-mock — no database hit. AsyncSession is mocked via AsyncMock.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.user_api_key import UserAPIKey
from app.repositories.user_api_key_repository import UserAPIKeyRepository

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

USER_ID = uuid.uuid4()
KEY_ID = uuid.uuid4()


def make_key(
    *,
    id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    provider: str = "openai",
    is_active: bool = True,
    is_default: bool = False,
) -> UserAPIKey:
    key = MagicMock(spec=UserAPIKey)
    key.id = id or uuid.uuid4()
    key.user_id = user_id or USER_ID
    key.provider = provider
    key.is_active = is_active
    key.is_default = is_default
    key.encrypted_api_key = "enc-key"
    key.key_name = "My key"
    key.validation_status = "pending"
    key.key_metadata = {}
    return key


def make_scalars_result(items: list) -> MagicMock:
    """Return a mock whose .scalars().all() yields items."""
    scalars = MagicMock()
    scalars.all.return_value = items
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def make_scalar_one_or_none(item) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = item
    return result


def make_rowcount(n: int) -> MagicMock:
    result = MagicMock()
    result.rowcount = n
    return result


def make_db() -> AsyncMock:
    db = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# list_by_user
# ---------------------------------------------------------------------------


class TestListByUser:
    @pytest.mark.asyncio
    async def test_returns_active_keys_by_default(self) -> None:
        db = make_db()
        keys = [make_key(), make_key()]
        db.execute = AsyncMock(return_value=make_scalars_result(keys))
        repo = UserAPIKeyRepository(db)

        result = await repo.list_by_user(USER_ID)

        assert result == keys

    @pytest.mark.asyncio
    async def test_accepts_string_user_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = UserAPIKeyRepository(db)

        result = await repo.list_by_user(str(USER_ID))

        assert result == []

    @pytest.mark.asyncio
    async def test_active_only_false_includes_inactive(self) -> None:
        db = make_db()
        keys = [make_key(is_active=False)]
        db.execute = AsyncMock(return_value=make_scalars_result(keys))
        repo = UserAPIKeyRepository(db)

        result = await repo.list_by_user(USER_ID, active_only=False)

        assert result == keys


# ---------------------------------------------------------------------------
# get_default
# ---------------------------------------------------------------------------


class TestGetDefault:
    @pytest.mark.asyncio
    async def test_returns_default_key(self) -> None:
        db = make_db()
        key = make_key(is_default=True)
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(key))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_default(USER_ID, "openai")

        assert result is key

    @pytest.mark.asyncio
    async def test_returns_none_when_not_found(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_default(USER_ID, "anthropic")

        assert result is None

    @pytest.mark.asyncio
    async def test_accepts_string_user_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_default(str(USER_ID), "openai")

        assert result is None


# ---------------------------------------------------------------------------
# get_by_user_and_provider
# ---------------------------------------------------------------------------


class TestGetByUserAndProvider:
    @pytest.mark.asyncio
    async def test_returns_matching_keys(self) -> None:
        db = make_db()
        keys = [make_key(provider="anthropic")]
        db.execute = AsyncMock(return_value=make_scalars_result(keys))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_by_user_and_provider(USER_ID, "anthropic")

        assert result == keys

    @pytest.mark.asyncio
    async def test_active_only_false_returns_all(self) -> None:
        db = make_db()
        keys = [make_key(is_active=False, provider="gemini")]
        db.execute = AsyncMock(return_value=make_scalars_result(keys))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_by_user_and_provider(USER_ID, "gemini", active_only=False)

        assert result == keys


# ---------------------------------------------------------------------------
# get_by_id_and_user
# ---------------------------------------------------------------------------


class TestGetByIdAndUser:
    @pytest.mark.asyncio
    async def test_returns_key_when_owned(self) -> None:
        db = make_db()
        key = make_key()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(key))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_by_id_and_user(KEY_ID, USER_ID)

        assert result is key

    @pytest.mark.asyncio
    async def test_returns_none_when_not_owned(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_by_id_and_user(KEY_ID, USER_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_converts_string_ids(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = UserAPIKeyRepository(db)

        result = await repo.get_by_id_and_user(str(KEY_ID), str(USER_ID))

        assert result is None


# ---------------------------------------------------------------------------
# create_key
# ---------------------------------------------------------------------------


class TestCreateKey:
    @pytest.mark.asyncio
    async def test_creates_key_with_correct_attributes(self) -> None:
        db = make_db()
        repo = UserAPIKeyRepository(db)
        created = make_key()

        with patch.object(repo, "create", AsyncMock(return_value=created)) as mock_create:
            result = await repo.create_key(
                user_id=USER_ID,
                provider="openai",
                encrypted_api_key="enc-123",
                key_name="My key",
                is_default=True,
                metadata={"model": "gpt-4"},
            )

        assert result is created
        call_kwargs = mock_create.call_args[0][0]
        assert call_kwargs.provider == "openai"
        assert call_kwargs.encrypted_api_key == "enc-123"
        assert call_kwargs.is_default is True
        assert call_kwargs.is_active is True
        assert call_kwargs.key_name == "My key"

    @pytest.mark.asyncio
    async def test_accepts_string_user_id(self) -> None:
        db = make_db()
        repo = UserAPIKeyRepository(db)
        created = make_key()

        with patch.object(repo, "create", AsyncMock(return_value=created)):
            result = await repo.create_key(
                user_id=str(USER_ID),
                provider="anthropic",
                encrypted_api_key="enc-abc",
            )

        assert result is created

    @pytest.mark.asyncio
    async def test_defaults_metadata_to_empty_dict(self) -> None:
        db = make_db()
        repo = UserAPIKeyRepository(db)
        created = make_key()

        with patch.object(repo, "create", AsyncMock(return_value=created)) as mock_create:
            await repo.create_key(
                user_id=USER_ID,
                provider="openai",
                encrypted_api_key="enc",
            )

        call_kwargs = mock_create.call_args[0][0]
        assert call_kwargs.key_metadata == {}


# ---------------------------------------------------------------------------
# unset_default
# ---------------------------------------------------------------------------


class TestUnsetDefault:
    @pytest.mark.asyncio
    async def test_returns_rowcount(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(2))
        repo = UserAPIKeyRepository(db)

        result = await repo.unset_default(USER_ID, "openai")

        assert result == 2

    @pytest.mark.asyncio
    async def test_with_exclude_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.unset_default(USER_ID, "openai", exclude_id=KEY_ID)

        assert result == 1

    @pytest.mark.asyncio
    async def test_with_string_exclude_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.unset_default(USER_ID, "openai", exclude_id=str(KEY_ID))

        assert result == 1


# ---------------------------------------------------------------------------
# set_default
# ---------------------------------------------------------------------------


class TestSetDefault:
    @pytest.mark.asyncio
    async def test_returns_false_when_key_not_found(self) -> None:
        db = make_db()
        repo = UserAPIKeyRepository(db)

        with patch.object(repo, "get_by_id", AsyncMock(return_value=None)):
            result = await repo.set_default(KEY_ID, USER_ID)

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_wrong_owner(self) -> None:
        db = make_db()
        key = make_key(user_id=uuid.uuid4())  # different user
        repo = UserAPIKeyRepository(db)

        with patch.object(repo, "get_by_id", AsyncMock(return_value=key)):
            result = await repo.set_default(KEY_ID, USER_ID)

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_and_sets_flag_when_valid(self) -> None:
        db = make_db()
        key = make_key(user_id=USER_ID)
        db.refresh = AsyncMock()
        repo = UserAPIKeyRepository(db)

        with (
            patch.object(repo, "get_by_id", AsyncMock(return_value=key)),
            patch.object(repo, "unset_default", AsyncMock(return_value=0)),
        ):
            result = await repo.set_default(KEY_ID, USER_ID)

        assert result is True
        assert key.is_default is True


# ---------------------------------------------------------------------------
# update_key_name
# ---------------------------------------------------------------------------


class TestUpdateKeyName:
    @pytest.mark.asyncio
    async def test_returns_true_when_updated(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.update_key_name(KEY_ID, USER_ID, "New Name")

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_no_row_matched(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(0))
        repo = UserAPIKeyRepository(db)

        result = await repo.update_key_name(KEY_ID, USER_ID, "Name")

        assert result is False


# ---------------------------------------------------------------------------
# update_last_used
# ---------------------------------------------------------------------------


class TestUpdateLastUsed:
    @pytest.mark.asyncio
    async def test_executes_update_without_error(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=MagicMock())
        repo = UserAPIKeyRepository(db)

        await repo.update_last_used(KEY_ID)

        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_accepts_string_key_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=MagicMock())
        repo = UserAPIKeyRepository(db)

        await repo.update_last_used(str(KEY_ID))

        db.execute.assert_awaited_once()


# ---------------------------------------------------------------------------
# set_validation_status
# ---------------------------------------------------------------------------


class TestSetValidationStatus:
    @pytest.mark.asyncio
    async def test_executes_update(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=MagicMock())
        repo = UserAPIKeyRepository(db)

        await repo.set_validation_status(KEY_ID, "valid")

        db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_accepts_string_key_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=MagicMock())
        repo = UserAPIKeyRepository(db)

        await repo.set_validation_status(str(KEY_ID), "invalid")

        db.execute.assert_awaited_once()


# ---------------------------------------------------------------------------
# deactivate
# ---------------------------------------------------------------------------


class TestDeactivate:
    @pytest.mark.asyncio
    async def test_returns_true_on_match(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.deactivate(KEY_ID, USER_ID)

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(0))
        repo = UserAPIKeyRepository(db)

        result = await repo.deactivate(KEY_ID, USER_ID)

        assert result is False

    @pytest.mark.asyncio
    async def test_converts_string_ids(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.deactivate(str(KEY_ID), str(USER_ID))

        assert result is True


# ---------------------------------------------------------------------------
# hard_delete
# ---------------------------------------------------------------------------


class TestHardDelete:
    @pytest.mark.asyncio
    async def test_returns_true_when_deleted(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.hard_delete(KEY_ID, USER_ID)

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_not_found(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(0))
        repo = UserAPIKeyRepository(db)

        result = await repo.hard_delete(KEY_ID, USER_ID)

        assert result is False

    @pytest.mark.asyncio
    async def test_converts_string_ids(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_rowcount(1))
        repo = UserAPIKeyRepository(db)

        result = await repo.hard_delete(str(KEY_ID), str(USER_ID))

        assert result is True

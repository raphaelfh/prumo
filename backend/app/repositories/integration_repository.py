"""
Integration Repository.

External integration persistence layer.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import ZoteroIntegration
from app.repositories.base import BaseRepository


class ZoteroIntegrationRepository(BaseRepository[ZoteroIntegration]):
    """Repository for Zotero integration records."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ZoteroIntegration)

    async def get_by_user(
        self,
        user_id: UUID | str,
        active_only: bool = True,
    ) -> ZoteroIntegration | None:
        """
        Fetch Zotero integration for a user.

        Args:
            user_id: User ID.
            active_only: Whether to return only active records.

        Returns:
            Integration record or None.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        query = select(ZoteroIntegration).where(ZoteroIntegration.user_id == user_id)

        if active_only:
            query = query.where(ZoteroIntegration.is_active.is_(True))

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def upsert(
        self,
        user_id: UUID | str,
        zotero_user_id: str,
        encrypted_api_key: str,
        library_type: str,
    ) -> ZoteroIntegration:
        """
        Create or update a Zotero integration.

        Args:
            user_id: User ID.
            zotero_user_id: Zotero user ID.
            encrypted_api_key: Encrypted API key.
            library_type: Library type ('user' or 'group').

        Returns:
            Created or updated integration.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        # Check whether a record already exists.
        existing = await self.get_by_user(user_id, active_only=False)

        if existing:
            # Update existing record.
            existing.zotero_user_id = zotero_user_id
            existing.encrypted_api_key = encrypted_api_key
            existing.library_type = library_type
            existing.is_active = True
            await self.db.flush()
            await self.db.refresh(existing)
            return existing
        else:
            # Create a new record.
            integration = ZoteroIntegration(
                user_id=user_id,
                zotero_user_id=zotero_user_id,
                encrypted_api_key=encrypted_api_key,
                library_type=library_type,
                is_active=True,
            )
            self.db.add(integration)
            await self.db.flush()
            await self.db.refresh(integration)
            return integration

    async def update_last_sync(self, user_id: UUID | str) -> None:
        """
        Update last-sync timestamp.

        Args:
            user_id: User ID.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        await self.db.execute(
            update(ZoteroIntegration)
            .where(ZoteroIntegration.user_id == user_id)
            .values(last_sync_at=datetime.now(UTC))
        )
        await self.db.flush()

    async def deactivate(self, user_id: UUID | str) -> bool:
        """
        Deactivate a user's integration.

        Args:
            user_id: User ID.

        Returns:
            True if deactivated.
        """
        if isinstance(user_id, str):
            user_id = UUID(user_id)

        result = await self.db.execute(
            update(ZoteroIntegration)
            .where(ZoteroIntegration.user_id == user_id)
            .values(is_active=False)
        )
        await self.db.flush()
        return result.rowcount > 0

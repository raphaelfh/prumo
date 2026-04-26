"""Service for evidence upload validation and metadata handling."""

import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import Client

from app.core.config import settings
from app.models.evaluation_decision import EvidenceRecord
from app.repositories.evaluation_evidence_repository import EvaluationEvidenceRepository
from app.schemas.evaluation_consensus import CreateEvidenceUploadRequest, EvidenceUploadResponse
from app.services.evaluation_observability_service import log_evaluation_event

ALLOWED_MIME_TYPES = {"application/pdf", "image/png", "image/jpeg", "text/plain"}
MAX_EVIDENCE_SIZE_BYTES = 25 * 1024 * 1024
_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _versioned_storage_path(
    project_id: UUID, entity_type: str, entity_id: UUID, filename: str
) -> str:
    """Return a unique storage path so re-uploads never overwrite prior evidence.

    Audit-grade requirement: every upload of evidence must produce a distinct
    object key, preserving the full history. We achieve that by injecting a
    short version segment (UTC timestamp + random uuid suffix) between the
    entity id and the original filename.
    """
    base, ext = os.path.splitext(filename)
    safe_base = _FILENAME_SAFE.sub("_", base) or "evidence"
    safe_ext = _FILENAME_SAFE.sub("", ext)
    version_segment = (
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    )
    versioned_filename = f"{safe_base}__{version_segment}{safe_ext}"
    return (
        f"evidence/{project_id}/{entity_type}/{entity_id}/{versioned_filename}"
    )


class EvaluationEvidenceService:
    """Validates evidence upload requests and stores metadata."""

    def __init__(self, db: AsyncSession, user_id: UUID, trace_id: str, supabase: Client):
        self.db = db
        self.user_id = user_id
        self.trace_id = trace_id
        self.supabase = supabase
        self._repo = EvaluationEvidenceRepository(db)

    async def create_upload_url(self, payload: CreateEvidenceUploadRequest) -> EvidenceUploadResponse:
        if payload.mime_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported mime_type")
        if payload.size_bytes > MAX_EVIDENCE_SIZE_BYTES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Evidence exceeds 25MB")

        storage_path = _versioned_storage_path(
            payload.project_id,
            payload.entity_type,
            payload.entity_id,
            payload.filename,
        )
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
        signed_upload = self.supabase.storage.from_(settings.EVALUATION_EVIDENCE_BUCKET).create_signed_upload_url(
            storage_path
        )
        upload_url = (
            signed_upload.get("signedURL")
            or signed_upload.get("signedUrl")
            or signed_upload.get("signed_url")
        )
        if not upload_url:
            token = signed_upload.get("token")
            if token:
                base_url = settings.SUPABASE_URL.rstrip("/")
                upload_url = (
                    f"{base_url}/storage/v1/object/upload/sign/"
                    f"{settings.EVALUATION_EVIDENCE_BUCKET}/{storage_path}?token={token}"
                )
        if not upload_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate signed upload URL",
            )

        record = EvidenceRecord(
            project_id=payload.project_id,
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            storage_path=storage_path,
            filename=payload.filename,
            mime_type=payload.mime_type,
            size_bytes=payload.size_bytes,
            uploaded_by=self.user_id,
        )
        await self._repo.append(record)
        await self.db.commit()

        log_evaluation_event(
            "evaluation_evidence_upload_url_created",
            trace_id=self.trace_id,
            project_id=payload.project_id,
            extra={"entity_type": payload.entity_type, "entity_id": str(payload.entity_id)},
        )
        return EvidenceUploadResponse(upload_url=upload_url, storage_path=storage_path, expires_at=expires_at)

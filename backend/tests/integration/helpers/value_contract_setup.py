"""Shared setup for the write-time value contract suites.

On the SEED template's root section it adds two live fields — a ``select``
whose live options include ``draft_only`` and a ``number`` in ``mg``/``g``
that refuses the not-applicable marker — then pins a fresh EXTRACT run to an
inactive version whose wide snapshot holds both fields but the select WITHOUT
``draft_only``. So the run's pinned tree differs from the live one, and the
seed's own ``sample_size`` field is absent from it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import run_in_extract

PINNED_OPTIONS = [
    {"value": "dev", "label": "Development"},
    {"value": "val", "label": "Validation"},
]
LIVE_OPTIONS = [*PINNED_OPTIONS, {"value": "draft_only", "label": "Draft only"}]


@dataclass(frozen=True)
class ContractRun:
    run_id: UUID
    template_id: UUID
    version_id: UUID
    instance_id: UUID
    select_id: UUID
    number_id: UUID


def _snapshot_field(field_id: UUID, name: str, label: str, field_type: str, **over: Any) -> dict:
    return {
        "id": str(field_id),
        "name": name,
        "label": label,
        "description": None,
        "field_type": field_type,
        "is_required": False,
        "validation_schema": None,
        "allowed_values": None,
        "unit": None,
        "allowed_units": None,
        "sort_order": 10,
        "llm_description": None,
        "allow_other": False,
        "other_label": None,
        "other_placeholder": None,
        "allows_not_applicable": False,
        "allows_not_evaluated": False,
        "allows_no_information": True,
        "is_entity_key": False,
        **over,
    }


async def contract_run(db: AsyncSession) -> ContractRun:
    select_id, number_id = uuid4(), uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, allowed_values) "
            "VALUES (:id, :et, 'study_type', 'Study type', 'select', 10, CAST(:av AS jsonb))"
        ),
        {"id": select_id, "et": SEED.primary_entity_type, "av": json.dumps(LIVE_OPTIONS)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, unit, allowed_units, "
            " allows_not_applicable) "
            "VALUES (:id, :et, 'dose', 'Dose', 'number', 11, 'mg', CAST(:units AS jsonb), false)"
        ),
        {"id": number_id, "et": SEED.primary_entity_type, "units": json.dumps(["mg", "g"])},
    )
    run_id = (await run_in_extract(db)).id

    schema = {
        "entity_types": [
            {
                "id": str(SEED.primary_entity_type),
                "name": "participants",
                "label": "Participants",
                "description": None,
                "entry_label": None,
                "parent_entity_type_id": None,
                "cardinality": "one",
                "sort_order": 0,
                "is_required": False,
                "fields": [
                    _snapshot_field(
                        select_id,
                        "study_type",
                        "Study type",
                        "select",
                        allowed_values=PINNED_OPTIONS,
                    ),
                    _snapshot_field(
                        number_id,
                        "dose",
                        "Dose",
                        "number",
                        unit="mg",
                        allowed_units=["mg", "g"],
                        sort_order=11,
                    ),
                ],
            }
        ]
    }
    version_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 970, CAST(:schema AS jsonb), :pub, false)"
        ),
        {
            "id": version_id,
            "tid": SEED.primary_template,
            "schema": json.dumps(schema),
            "pub": SEED.primary_profile,
        },
    )
    await db.execute(
        text("UPDATE public.extraction_runs SET version_id = :vid WHERE id = :rid"),
        {"vid": version_id, "rid": run_id},
    )
    await db.flush()
    db.expire_all()
    return ContractRun(
        run_id=run_id,
        template_id=SEED.primary_template,
        version_id=version_id,
        instance_id=SEED.primary_instance,
        select_id=select_id,
        number_id=number_id,
    )


async def as_text_field(db: AsyncSession, field_id: UUID) -> None:
    """Make a seeded field a ``text`` field for the rest of the test transaction.

    Reviewer writes are held to the field's value contract, and the seed's
    ``sample_size`` is a ``number``. Suites that use distinctive strings as
    sentinels (blind-review leaks, suggestion status) retype the field instead
    of weakening the sentinel. The seed template's v1 snapshot is narrow, so a
    run on it reads the live row.
    """
    await db.execute(
        text(
            "UPDATE public.extraction_fields "
            "SET field_type = 'text', unit = NULL, allowed_units = NULL WHERE id = :id"
        ),
        {"id": field_id},
    )

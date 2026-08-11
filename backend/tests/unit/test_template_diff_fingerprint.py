"""The publish fingerprint (B-9b2b, T1).

The Publish sheet is computed lock-free, so between render and click the
projection can move three ways: the tree changes, a row's tier or
``affects_recorded_data`` moves because a reviewer recorded an answer, or a
concurrent publish moves the baseline. The fingerprint is what lets the
publish path notice — so it hashes the **projection plus the active version
id**, not the live snapshot: a concurrent publish leaves the live tree
byte-identical while making every row in the diff wrong.

Row order is untrustworthy input: ``SNAPSHOT_SQL`` orders by an unconstrained
``sort_order`` (``extraction_snapshot.py:82``, ``:88``), so two sections can
legitimately swap between two reads of an unchanged tree. The hash therefore
canonicalises its own input rather than trusting the caller, which is also
what keeps the shipped B-9b2a wire order untouched (D5).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from uuid import UUID

from app.domain.template_change import ChangeTier, ChangeVariant, OpaqueValueState
from app.schemas.hitl_session import TemplateChangeRowRead
from app.services.template_diff_read import fingerprint

ACTIVE_VERSION = UUID("11111111-1111-4111-8111-111111111111")
OTHER_VERSION = UUID("22222222-2222-4222-8222-222222222222")

# Two rows that a `(label_path, attribute, option_code)` sort would TIE on:
# same duplicate section label, same absent attribute, same absent option
# code. Only the composite id separates them, which is why the canonical
# sort keys off that and nothing else.
DUPLICATE_LABEL = "Participants"


def _row(node_id: str, tier: ChangeTier = ChangeTier.DESTRUCTIVE) -> TemplateChangeRowRead:
    return TemplateChangeRowRead(
        id=f"removed:entity_type:{node_id}:-:-",
        variant=ChangeVariant.ENTITY_TYPE_REMOVED,
        tier=tier,
        label_path=[DUPLICATE_LABEL],
    )


ROW_A = _row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
ROW_B = _row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

#: One differing, VALID value per row field, for the exhaustiveness proof
#: below. Hand-written rather than derived: the point is that a new field
#: forces a human to state what "changed" means for it, instead of a clever
#: generator quietly producing an invalid value and skipping the assertion.
_ALTERNATIVE: dict[str, object] = {
    "id": "removed:entity_type:cccccccc-cccc-4ccc-8ccc-cccccccccccc:-:-",
    "variant": ChangeVariant.FIELD_REMOVED.value,
    "tier": ChangeTier.COSMETIC.value,
    "label_path": [DUPLICATE_LABEL, "Age"],
    "attribute": "field_type",
    "before": "text",
    "after": "number",
    "before_opaque_state": OpaqueValueState.PRESENT.value,
    "after_opaque_state": OpaqueValueState.EMPTY.value,
    "reorder_count": 3,
    "affects_recorded_data": True,
}


def test_row_order_does_not_change_the_hash() -> None:
    """The caller's order is noise; the hash must canonicalise it itself.

    Mutation proof for this lives below — remove the internal sort and this
    fails for every permutation, not just occasionally.
    """
    assert fingerprint(ACTIVE_VERSION, [ROW_A, ROW_B]) == fingerprint(
        ACTIVE_VERSION, [ROW_B, ROW_A]
    )


def test_a_tier_escalation_alone_changes_the_hash() -> None:
    """The whole point of hashing the projection rather than the tree.

    A reviewer recording one answer flips a field row SEMANTIC → DESTRUCTIVE
    (``template_diff.py:535-536``) without touching the template at all.
    """
    semantic = _row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ChangeTier.SEMANTIC)
    assert fingerprint(ACTIVE_VERSION, [semantic]) != fingerprint(ACTIVE_VERSION, [ROW_A])


def test_a_moved_baseline_alone_changes_the_hash() -> None:
    """A concurrent publish moves the baseline under an identical tree.

    Hashing the live snapshot would still match here; hashing the projection
    plus the active version id does not.
    """
    assert fingerprint(ACTIVE_VERSION, [ROW_A]) != fingerprint(OTHER_VERSION, [ROW_A])


def test_affects_recorded_data_alone_changes_the_hash() -> None:
    """``allow_other`` rows never escalate their tier — they move this flag.

    Without this the one escalation family that is invisible to ``tier``
    would slip past the drift check.
    """
    flagged = ROW_A.model_copy(update={"affects_recorded_data": True})
    assert fingerprint(ACTIVE_VERSION, [flagged]) != fingerprint(ACTIVE_VERSION, [ROW_A])


def test_an_absent_baseline_is_hashable() -> None:
    """The first-ever publish has no active version and must not explode."""
    assert fingerprint(None, []) != fingerprint(ACTIVE_VERSION, [])


def test_hash_is_stable_across_processes() -> None:
    """No ``hash()``, no set iteration — those are salted per process.

    A fingerprint that changes between the read request and the publish
    request would refuse every publish, so this is the assertion that keeps
    the feature usable at all. Two subprocesses with different
    ``PYTHONHASHSEED`` values must agree.
    """
    program = (
        "from uuid import UUID;"
        "from app.domain.template_change import ChangeTier, ChangeVariant;"
        "from app.schemas.hitl_session import TemplateChangeRowRead;"
        "from app.services.template_diff_read import fingerprint;"
        "row = TemplateChangeRowRead("
        "id='removed:entity_type:x:-:-',"
        "variant=ChangeVariant.ENTITY_TYPE_REMOVED,"
        "tier=ChangeTier.DESTRUCTIVE,"
        "label_path=['A','B']);"
        "print(fingerprint(UUID('11111111-1111-4111-8111-111111111111'), [row]))"
    )
    # Inherit the parent environment and vary ONLY the seed. A minimal env
    # looks tidier and is wrong: importing the app pulls in Settings, which
    # finds backend/.env locally but has nothing to read on CI, so the
    # subprocess died there while passing on a developer machine.
    digests = {
        subprocess.run(  # noqa: S603 - fixed argv, no shell
            [sys.executable, "-c", program],
            capture_output=True,
            text=True,
            check=True,
            env={**os.environ, "PYTHONHASHSEED": seed},
        ).stdout.strip()
        for seed in ("0", "1", "12345")
    }
    assert len(digests) == 1, f"fingerprint is process-dependent: {digests}"


def test_every_row_field_feeds_the_hash() -> None:
    """A field added to the row model must not silently escape the hash.

    The failure this prevents is quiet: a new column on the wire that the
    drift check ignores, so the manager acks one thing and publishes another.
    Hashing ``model_dump`` rather than a hand-listed tuple is what makes this
    hold, and this test is what stops someone replacing it with a tuple.
    """
    assert set(_ALTERNATIVE) == set(TemplateChangeRowRead.model_fields), (
        "TemplateChangeRowRead gained or lost a field. Add it to _ALTERNATIVE "
        "with a differing value, so the hash is proven to depend on it."
    )
    baseline = fingerprint(ACTIVE_VERSION, [ROW_A])
    dumped = ROW_A.model_dump(mode="json")
    for field, alternative in _ALTERNATIVE.items():
        assert dumped[field] != alternative, f"_ALTERNATIVE[{field!r}] must differ from ROW_A"
        row = TemplateChangeRowRead.model_validate({**dumped, field: alternative})
        assert fingerprint(ACTIVE_VERSION, [row]) != baseline, (
            f"changing {field!r} left the fingerprint unchanged — the drift check is blind to it"
        )


def test_hash_is_a_hex_digest() -> None:
    """Opaque to the client, but it travels in JSON and in a URL-safe body."""
    digest = fingerprint(ACTIVE_VERSION, [ROW_A])
    assert len(digest) == 64
    assert json.dumps(digest)
    int(digest, 16)

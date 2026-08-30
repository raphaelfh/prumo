"""Flatten picots_config_ai_review.timing to match its five siblings.

Revision ID: 0063_flatten_picots_timing
Revises: 0062_allows_no_information
Create Date: 2026-08-30

``timing`` is the only PICOTS slot stored one level deeper than the rest:
``{prediction_moment: <item>, prediction_horizon: <item>}`` instead of a plain
``{description, inclusion[], exclusion[]}``. The settings UI wrote it through a
dotted-path branch that existed only to reach that nesting; the PICOT editor
that replaces it writes the flat shape like every other slot, so the nesting
loses its last writer here.

**Not "provably lossless" — the design doc was wrong about that.** It claimed no
UI had ever written ``timing``. One had: a hardcoded accordion bound to
``timing.prediction_moment`` / ``timing.prediction_horizon``. So this migration
merges real data, and its realistic input is not "two objects" but an object
BESIDE a string — editing one half spread the parent and left the other half at
its ``""`` default. A naive ``a || '; ' || b`` returns SQL NULL on that shape and
destroys the half a manager actually filled.

Every sub-slot is therefore type-gated, both descriptions go through
``concat_ws`` (which skips NULLs, so one filled half survives alone) and both
array pairs through ``COALESCE(..., '[]')`` (``jsonb || NULL`` is NULL, and
``jsonb_array_elements`` on a scalar RAISES — which would abort
``alembic upgrade head`` and with it the Railway deploy, since the Dockerfile
chains them).

A row can hold BOTH shapes at once, so the merge folds the slot's own flat
values in FIRST and the two nested halves after. That hybrid is not exotic: it
appears the moment this migration lands before the frontend deploy, because a
browser on the old bundle edits one timing box, ``updatePICOTSField`` SPREADS
the parent, and the nested key lands back beside the flat one. Merging only the
nested halves would delete what the new editor wrote.

The predicate admits ONLY objects that actually carry a nested key. That keeps
the UPDATE off the ~100% of rows whose column is NULL (there is no server
default; projects are created by an RPC that never sets it), and off rows that
are already flat — which makes the statement idempotent, the invariant the
round-trip suite needs since it downgrades below this revision and back
repeatedly. ``trg_projects_updated_at`` fires on every UPDATE of
``public.projects``, so a loose WHERE would also restamp every project row.

Verified against Postgres 17.6 on all nine reachable shapes: column NULL, no
``timing`` key, ``{}``, the ORM's string-pair default, object-beside-string,
both objects filled, already-flat, ``timing`` as a scalar string, and
``inclusion`` as JSON null.
"""

from alembic import op

revision = "0063_flatten_picots_timing"
down_revision = "0062_allows_no_information"
branch_labels = None
depends_on = None

# Only objects carrying at least one nested key. Excludes NULL, absent, `{}`,
# already-flat and scalar `timing` — see the module docstring.
_NESTED = (
    "jsonb_typeof(picots_config_ai_review -> 'timing') = 'object' "
    "AND picots_config_ai_review -> 'timing' ?| array['prediction_moment', 'prediction_horizon']"
)


def _own_description() -> str:
    """The slot's OWN flat description — a hybrid row carries one already."""
    return "NULLIF(picots_config_ai_review -> 'timing' ->> 'description', '')"


def _own_array(key: str) -> str:
    return (
        f"COALESCE(CASE WHEN jsonb_typeof(picots_config_ai_review -> 'timing' -> '{key}') = 'array' "
        f"THEN picots_config_ai_review -> 'timing' -> '{key}' END, '[]'::jsonb)"
    )


def _description(part: str) -> str:
    """One half's description, or SQL NULL when it is absent, blank or a scalar.

    No type gate is needed here: ``->>`` on a scalar or a missing key already
    yields SQL NULL rather than raising, and ``concat_ws`` skips NULLs. The
    ``NULLIF`` is NOT redundant, though — an OBJECT half carrying
    ``description: ""`` returns the empty string, and ``concat_ws('; ', '', 'b')``
    is ``"; b"``: a leading separator glued onto the prompt.
    """
    return f"NULLIF(picots_config_ai_review -> 'timing' -> '{part}' ->> 'description', '')"


def _array(part: str, key: str) -> str:
    """One half's criteria list, or an empty array — never SQL NULL."""
    return (
        "COALESCE(CASE WHEN jsonb_typeof("
        f"picots_config_ai_review -> 'timing' -> '{part}' -> '{key}') = 'array' "
        f"THEN picots_config_ai_review -> 'timing' -> '{part}' -> '{key}' END, '[]'::jsonb)"
    )


def upgrade_statements() -> list[str]:
    """The one set-based UPDATE.

    Exposed so the sibling test can run the exact statement inside a rolled-back
    transaction — shelling out ``alembic downgrade`` for a *data* migration would
    rewrite the whole shared dev database rather than the test's own rows
    (the reason 0039 does the same).
    """
    merged = (
        "jsonb_strip_nulls(jsonb_build_object("
        "'description', NULLIF(concat_ws('; ', "
        f"{_own_description()}, "
        f"{_description('prediction_moment')}, {_description('prediction_horizon')}), ''), "
        "'inclusion', "
        f"{_own_array('inclusion')} || {_array('prediction_moment', 'inclusion')} "
        f"|| {_array('prediction_horizon', 'inclusion')}, "
        "'exclusion', "
        f"{_own_array('exclusion')} || {_array('prediction_moment', 'exclusion')} "
        f"|| {_array('prediction_horizon', 'exclusion')}"
        "))"
    )
    return [
        "UPDATE public.projects "
        f"SET picots_config_ai_review = jsonb_set(picots_config_ai_review, '{{timing}}', {merged}) "
        f"WHERE {_NESTED}"
    ]


def downgrade_statements() -> list[str]:
    """Deliberately empty — see ``downgrade``."""
    return []


def upgrade() -> None:
    for stmt in upgrade_statements():
        op.execute(stmt)


def downgrade() -> None:
    """A documented NO-OP, following 0017 and 0059.

    Re-nesting cannot be correct: a flat ``timing`` after this migration is
    indistinguishable from one a post-migration writer produced, so a blanket
    re-nest would corrupt rows that were never nested and blind the reader that
    now expects the flat shape. The flattened value is also information-
    preserving for every reader on both sides — the old UI renders empty boxes
    for a missing nested key rather than breaking.

    Keeping it empty is load-bearing for the round-trip suite, which downgrades
    below this revision and upgrades back repeatedly: with the predicate
    excluding already-flat rows, up -> down -> up is a no-op instead of
    re-merging ``"a; b"`` into ``"a; b; "``.
    """

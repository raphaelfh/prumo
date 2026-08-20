"""Canary for the verify_all.sh gate audit: prove the checker can fail.

A checker that passes over a tree it cannot actually inspect is the same class
of bug it is meant to police. These cases feed the audit synthetic harnesses
containing each known way to lose an exit status and require it to object —
including the backslash-continuation form, which is invisible to a line-wise
`grep 'run_gate.*|'` and was live in the real script when this was written.
"""

from __future__ import annotations

import pytest

from .test_verify_all_gates import find_status_eating_gates

# The real 2026-08-09 bug: `run_gate` and the pipe on different physical lines.
CONTINUATION_BUG = """\
run_gate "smoke:playwright" \\
  bash -c 'npm run test:e2e:local -- --project=local-ui 2>&1 | tail -30'
"""

SINGLE_LINE_PIPE = """\
run_gate "lint:tsc" bash -c 'npx tsc --noEmit -p tsconfig.json | tail -20'
"""

# `| cat` eats the status exactly as `| tail` does — a filter blocklist would
# miss this, so the audit bans the pipe itself.
UNUSUAL_FILTER = """\
run_gate "test:vitest" bash -c 'npm test -- --run | cat'
"""

EXPLICIT_SWALLOW = """\
run_gate "lint:ruff" bash -c 'make lint-backend || true'
"""

# `;` drops the `cd`'s verdict: pytest then runs against the wrong tree.
SEMICOLON_CHAIN = """\
run_gate "test:pytest" bash -c 'cd backend; uv run pytest -q'
"""

BACKGROUNDED = """\
run_gate "test:pytest" bash -c 'cd backend && uv run pytest -q &'
"""


@pytest.mark.parametrize(
    "label,script",
    [
        ("backslash continuation", CONTINUATION_BUG),
        ("single-line pipe", SINGLE_LINE_PIPE),
        ("non-tail filter", UNUSUAL_FILTER),
        ("explicit || true", EXPLICIT_SWALLOW),
        ("semicolon chain", SEMICOLON_CHAIN),
        ("backgrounded gate", BACKGROUNDED),
    ],
)
def test_audit_flags_every_status_eating_shape(label: str, script: str) -> None:
    assert find_status_eating_gates(script), f"audit missed the {label} case"


def test_audit_accepts_and_chains_and_redirections() -> None:
    """`&&` preserves failure, and `2>&1` is a redirection, not a control op.

    Without this, the audit would flag the healthy `lint:ruff` gate and get
    weakened or deleted by the next person to touch it.
    """
    healthy = """\
run_gate "lint:ruff" \\
  bash -c 'cd backend && uv run ruff check . && uv run ruff format --check .'
run_gate "lint:eslint" npm run lint --silent
run_gate "test:vitest" npm test -- --run
"""
    assert find_status_eating_gates(healthy) == []


def test_audit_does_not_trip_on_prose_or_quoted_arguments() -> None:
    """Labels, SKIP reasons and quoted args are data, not control operators.

    A checker that cries wolf gets weakened by the next person who touches it,
    so the false-positive direction matters as much as the false-negative one.
    """
    prose = """\
skip_gate "test:vitest" "node_modules missing; run npm ci"
skip_gate "smoke:playwright" "local stack unreachable — run make start"
run_gate "fitness:custom" python3 check.py --pattern "^(alpha|beta)$"
"""
    assert find_status_eating_gates(prose) == []


def test_audit_ignores_non_gate_lines() -> None:
    """Pipes outside a gate command are ordinary shell, not a hidden verdict."""
    incidental = """\
touched=$(git diff --name-only HEAD | grep -c '^backend/')
echo "changed: ${touched}" | tee /tmp/log
"""
    assert find_status_eating_gates(incidental) == []

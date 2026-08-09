"""Green-path test for scripts/verify_all.sh: no gate may hide its verdict.

`verify_all.sh` is the local verification harness (`make quality-scan`). It is
NOT run by CI, so a gate that silently reports OK is only ever caught here.

The bug this file exists to prevent (observed 2026-08-09): a gate was written as

    run_gate "smoke:playwright" \\
      bash -c 'npm run test:e2e:local -- --project=local-ui 2>&1 | tail -30'

The harness sets `set -o pipefail`, but that option does **not** cross into a
`bash -c` child shell, so the pipeline's exit status was `tail`'s — always 0.
Playwright's global setup died with "Timed out waiting for healthcheck", zero
tests ran, and the harness printed `smoke:playwright: OK`.

`|` is not the only way to lose a status: `;` drops the left-hand command's
verdict (`cd backend; pytest` runs in the wrong tree if the `cd` fails) and
`|| true` discards it outright. Only `&&` chains preserve failure. The audit
below therefore bans `|`, `;` and background `&` inside gate commands, and is
applied to the *logical* command (backslash continuations collapsed) because
`run_gate` and its offending pipe live on different physical lines — a
line-wise grep for `run_gate.*|` matches nothing even when the bug is live.

The matching canary lives in `test_verify_all_gates_canary.py`.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
VERIFY_ALL = REPO_ROOT / "scripts" / "verify_all.sh"

# Redirections that legitimately contain `&` and must not count as violations.
_REDIRECTIONS = re.compile(r"\d?>&\d|&>>?")
# `&&` preserves failure; every other control operator can discard it.
_SAFE_CHAIN = "\x00AND\x00"


def _collapse_continuations(text: str) -> str:
    """Join backslash-continued shell lines into one logical line each."""
    return re.sub(r"\\\n\s*", " ", text)


def _executable_lines(text: str) -> str:
    """Drop comment-only lines, so prose about a bug never trips its own guard."""
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def _status_eating_operators(command: str) -> list[str]:
    """Return the control operators in `command` that can discard an exit status."""
    stripped = _REDIRECTIONS.sub("", command).replace("&&", _SAFE_CHAIN)
    return [op for op in ("|", ";", "&") if op in stripped]


def _gate_statements(script_text: str) -> list[str]:
    """Every logical `run_gate` / `skip_gate` invocation, continuations joined."""
    return [
        line.strip()
        for line in _collapse_continuations(script_text).splitlines()
        if re.match(r"^(run_gate|skip_gate)\b", line.strip())
    ]


def find_status_eating_gates(script_text: str) -> list[str]:
    """Return every gate command in `script_text` that can hide a failure.

    Scope, stated honestly: this audits the *text of the gate invocation* and
    the body of any `bash -c '...'` it spells out inline. It cannot see into a
    command it merely names — `make db-lint-migrations` swallows its own
    squawk verdict and this audit will never notice. Pinning what each gate is
    allowed to invoke is `test_gate_roster_is_pinned`'s job; keeping a human in
    the loop on any new gate is the actual defense.
    """
    violations: list[str] = []
    for statement in _gate_statements(script_text):
        # A `bash -c '<body>'` runs in a child shell that does NOT inherit the
        # harness's `set -o pipefail`, so each body is audited as a command.
        bodies = re.findall(r"bash -c '([^']*)'", statement)
        # Labels and SKIP reasons are prose, not commands: a reason reading
        # "no migrations; nothing to lint" must not read as a `;` chain.
        without_prose = re.sub(r"'[^']*'|\"[^\"]*\"", "", statement)

        for candidate in [without_prose, *bodies]:
            operators = _status_eating_operators(candidate)
            if operators:
                violations.append(f"{''.join(operators)!r} in: {statement}")
                break
    return violations


def test_no_gate_hides_its_exit_status() -> None:
    assert VERIFY_ALL.is_file(), f"missing harness script: {VERIFY_ALL}"
    violations = find_status_eating_gates(VERIFY_ALL.read_text())
    assert not violations, (
        "scripts/verify_all.sh has gate(s) whose exit status can be discarded.\n"
        "Only `&&` preserves failure; `|`, `;` and `&` do not, and `set -o "
        "pipefail` does not cross into `bash -c`.\n  " + "\n  ".join(violations)
    )


def test_typecheck_gate_uses_the_project_that_has_files() -> None:
    """`tsc -p tsconfig.json` type-checks nothing — it is a solution config.

    `tsconfig.json` carries `"files": []` plus `references`, which only
    `tsc --build` honors. Pointed at it, `tsc --noEmit` exits 0 even with a
    real type error in `frontend/`. `npm run typecheck` (= `tsc -p
    tsconfig.app.json --noEmit`) is what CI runs and what actually checks.
    """
    text = _executable_lines(VERIFY_ALL.read_text())
    assert "-p tsconfig.json" not in text, (
        "verify_all.sh type-checks the solution config `tsconfig.json`, which "
        "matches zero files. Use `npm run typecheck` (tsconfig.app.json)."
    )
    assert "npm run typecheck" in text, (
        "verify_all.sh should single-source the typecheck command with CI "
        "(.github/workflows/ci.yml) via `npm run typecheck`."
    )


def test_gate_roster_is_pinned() -> None:
    """Pin which gates exist and what each one invokes.

    The text audit above only inspects the invocation it can see, so a blind
    gate can be smuggled in behind a shell function (`run_gate "x" _helper`)
    or a variable. Pinning the roster does not detect that on its own — it
    forces the change to show up in *this* file, in front of a reviewer, which
    is the part that actually works.

    Update this list deliberately when adding or removing a gate.
    """
    expected = {
        "lint:ruff": "bash -c 'cd backend && uv run ruff check . && uv run ruff format --check .'",
        "lint:eslint": "npm run lint --silent",
        "lint:tsc": "npm run typecheck --silent",
        "test:pytest": "bash -c 'cd backend && uv run pytest -q --tb=short'",
        "test:vitest": "npm test -- --run",
        "build:react-compiler": "node scripts/check_compiler_coverage.mjs",
        "fitness:run_all": 'bash "${SCRIPT_DIR}/fitness/run_all.sh" ${SCOPE:+--scope "${SCOPE}"}',
        "smoke:playwright": "npx playwright test --project=local-api --project=local-ui",
    }
    actual = {}
    for statement in _gate_statements(VERIFY_ALL.read_text()):
        match = re.match(r'^run_gate\s+"([^"]+)"\s+(.*)$', statement)
        if match:
            actual[match.group(1)] = match.group(2).strip()

    assert actual == expected, (
        "the gate roster changed. If that is intentional, update this test in "
        "the same commit so the new gate gets read by a human.\n"
        f"  added/changed: { {k: v for k, v in actual.items() if expected.get(k) != v} }\n"
        f"  removed: { {k: v for k, v in expected.items() if k not in actual} }"
    )


def test_every_skip_is_visible_in_the_summary() -> None:
    """A gate that skipped must say so in the Summary, not just mid-scroll.

    The Summary block is the part an agent or human actually reads. A SKIP that
    only prints a banner 200 lines earlier reads as "gate absent", which is the
    same blindness as reporting OK.
    """
    text = _collapse_continuations(VERIFY_ALL.read_text())
    skip_banners = re.findall(r'echo "=== (\S+) SKIP', text)
    assert skip_banners, "expected verify_all.sh to have SKIP branches"

    recorded = set(re.findall(r'results\+=\("(\S+): SKIP', text))
    recorded |= set(re.findall(r"skip_gate\s+\"(\S+)\"", text))

    missing = sorted({label for label in skip_banners if label not in recorded})
    assert not missing, (
        "these gates print a SKIP banner but record no Summary line, so a "
        f"skipped run looks identical to a run that never had the gate: {missing}"
    )

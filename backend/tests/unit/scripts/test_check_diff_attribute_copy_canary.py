"""Canary for scripts/fitness/check_diff_attribute_copy.py.

Builds the smallest tree the check can read — a stub `template_diff.py`, a
stub diff sheet, a stub copy catalogue — and plants each failure mode in
turn. A check whose canary passes on a broken tree is decorative.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CHECK = REPO_ROOT / "scripts" / "fitness" / "check_diff_attribute_copy.py"

# `entry_label` rides a NAME key, exercising the constant resolution the real
# ATTRIBUTE_TIERS needs; OPTION_KEY / TEMPLATE_INSTRUCTION_KEY are emitted as
# bare constants and must be picked up without appearing in the dict.
SERVICE = """\
OPTION_KEY = "allowed_values"
TEMPLATE_INSTRUCTION_KEY = "llm_template_instruction"
ENTRY_LABEL_KEY = "entry_label"

ATTRIBUTE_TIERS: dict[str, ChangeTier] = {
    "label": ChangeTier.COSMETIC,
    ENTRY_LABEL_KEY: ChangeTier.SEMANTIC,
}
"""


def _setup(root: Path, *, sheet_entries: dict[str, str], copy_keys: list[str]) -> None:
    service = root / "backend" / "app" / "services"
    service.mkdir(parents=True, exist_ok=True)
    (service / "template_diff.py").write_text(SERVICE)

    sheet = root / "frontend" / "components" / "extraction" / "template-config"
    sheet.mkdir(parents=True, exist_ok=True)
    rows = "".join(f"  {attr}: '{key}',\n" for attr, key in sheet_entries.items())
    (sheet / "TemplateConfigDiffSheet.tsx").write_text(
        "const ATTRIBUTE_COPY: Record<string, CopyKey> = {\n" + rows + "};\n"
    )

    copy = root / "frontend" / "lib" / "copy"
    copy.mkdir(parents=True, exist_ok=True)
    defs = "".join(f"  {key}: 'text',\n" for key in copy_keys)
    (copy / "templateConfig.ts").write_text(
        "export const templateConfig = {\n" + defs + "} as const;\n"
    )


def _run(root: Path):
    return subprocess.run(
        [sys.executable, str(CHECK), "--repo-root", str(root)],
        capture_output=True,
        text=True,
        timeout=15,
    )


ALL_MAPPED = {
    "label": "diffAttrLabel",
    "entry_label": "diffAttrEntryLabel",
    "allowed_values": "diffAttrAllowedValues",
    "llm_template_instruction": "diffAttrLlmTemplateInstruction",
}
ALL_DEFINED = sorted(ALL_MAPPED.values())


def test_fully_labelled_passes(tmp_path: Path) -> None:
    _setup(tmp_path, sheet_entries=ALL_MAPPED, copy_keys=ALL_DEFINED)
    proc = _run(tmp_path)
    assert proc.returncode == 0, proc.stdout
    assert "4 diff attributes all labelled" in proc.stdout


def test_attribute_with_no_map_entry_fails(tmp_path: Path) -> None:
    entries = {k: v for k, v in ALL_MAPPED.items() if k != "entry_label"}
    _setup(tmp_path, sheet_entries=entries, copy_keys=ALL_DEFINED)
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert "'entry_label' has no ATTRIBUTE_COPY entry" in proc.stdout


def test_constant_emitted_attribute_is_covered(tmp_path: Path) -> None:
    # OPTION_KEY never appears in ATTRIBUTE_TIERS, so a check reading only
    # that dict would let `allowed_values` through unlabelled.
    entries = {k: v for k, v in ALL_MAPPED.items() if k != "allowed_values"}
    _setup(tmp_path, sheet_entries=entries, copy_keys=ALL_DEFINED)
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert "'allowed_values' has no ATTRIBUTE_COPY entry" in proc.stdout


def test_mapped_to_an_undefined_copy_key_fails(tmp_path: Path) -> None:
    _setup(
        tmp_path,
        sheet_entries=ALL_MAPPED,
        copy_keys=[k for k in ALL_DEFINED if k != "diffAttrEntryLabel"],
    )
    proc = _run(tmp_path)
    assert proc.returncode == 1, proc.stdout
    assert "'entry_label' → 'diffAttrEntryLabel'" in proc.stdout


def test_missing_source_file_is_an_internal_error(tmp_path: Path) -> None:
    proc = _run(tmp_path)
    assert proc.returncode == 2, proc.stdout
    assert "not found" in proc.stderr

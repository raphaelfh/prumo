#!/usr/bin/env python3
"""check_skill_router_sync.py — prumo fitness function.

Asserts every skill named in CLAUDE.md's `## Which skill to load` router
resolves to a real `.claude/skills/<name>/` directory. A dead router entry
sends agents to a skill that does not exist; this fires the moment the router
and the skills tree drift apart.

Exit codes: 0 (no dead entries) | 1 (dead entry) | 2 (router section missing).
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REPO_ROOT = SCRIPT_DIR.parent.parent

ROUTER_HEADING = "## Which skill to load"
SKILL_TICK_RE = re.compile(r"→\s*`([a-z][a-z0-9-]+)`")


def router_skills(claude_md: str) -> list[str]:
    lines = claude_md.splitlines()
    out: list[str] = []
    in_section = False
    for line in lines:
        if line.strip() == ROUTER_HEADING:
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section:
            m = SKILL_TICK_RE.search(line)
            if m:
                out.append(m.group(1))
    return out


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="prumo skill-router sync check")
    p.add_argument("--repo-root", default=None)
    p.add_argument("--emit-telemetry", default=None)
    args = p.parse_args(argv)

    root = Path(args.repo_root).resolve() if args.repo_root else DEFAULT_REPO_ROOT
    claude_path = root / "CLAUDE.md"
    skills_dir = root / ".claude" / "skills"

    if not claude_path.is_file():
        print(f"ERROR: CLAUDE.md not found: {claude_path}", file=sys.stderr)
        return 2

    started = time.time()
    named = router_skills(claude_path.read_text(encoding="utf-8"))
    if not named:
        print(f"ERROR: no '{ROUTER_HEADING}' router entries found in CLAUDE.md", file=sys.stderr)
        return 2

    existing = (
        {p.name for p in skills_dir.iterdir() if p.is_dir()} if skills_dir.is_dir() else set()
    )
    dead = [s for s in named if s not in existing]
    duration_ms = int((time.time() - started) * 1000)
    exit_code = 1 if dead else 0

    if dead:
        print(
            f"check_skill_router_sync.py: FAIL ({duration_ms} ms; {len(dead)} dead router entries)"
        )
        for s in dead:
            print(f"  `{s}` in CLAUDE.md router has no .claude/skills/{s}/ dir")
    else:
        print(
            f"check_skill_router_sync.py: OK ({duration_ms} ms; {len(named)} router entries all resolve)"
        )
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

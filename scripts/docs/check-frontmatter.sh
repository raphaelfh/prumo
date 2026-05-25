#!/usr/bin/env bash
# Fail if any tracked Markdown doc under docs/ or in the repo root lacks
# the required YAML frontmatter keys: status, last_reviewed, owner.
#
# Exclusions: node_modules, archives, test artefacts.

set -euo pipefail

REQUIRED_KEYS=("status" "last_reviewed" "owner")
FAIL=0

while IFS= read -r -d '' file; do
  case "$file" in
    *node_modules*|*playwright-report*|*test-results*|*.pytest_cache*|*backend/alembic/versions/archive*|*docs/superpowers/specs/archive*|*docs/superpowers/plans/archive*) continue ;;
  esac

  # Only enforce on files that should carry frontmatter: docs/**, root *.md, CLAUDE.md
  case "$file" in
    docs/*.md|docs/**/*.md|README.md|CLAUDE.md|.claude/CLAUDE.md) : ;;
    *) continue ;;
  esac

  if ! head -1 "$file" | grep -q '^---$'; then
    echo "MISSING frontmatter delimiter: $file"
    FAIL=1
    continue
  fi

  for key in "${REQUIRED_KEYS[@]}"; do
    if ! awk '/^---$/{c++; next} c==1' "$file" | grep -q "^${key}:"; then
      echo "MISSING key '${key}': $file"
      FAIL=1
    fi
  done
done < <(git ls-files -z '*.md')

if [[ $FAIL -ne 0 ]]; then
  echo
  echo "Frontmatter check FAILED. See docs/adr/0001-use-madr.md (or docs/README.md) for the required format."
  exit 1
fi

echo "Frontmatter check passed for all tracked docs."

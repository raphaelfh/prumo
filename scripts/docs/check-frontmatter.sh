#!/usr/bin/env bash
# Fail if any tracked Markdown doc under docs/ or in the repo root lacks the
# required frontmatter keys (status, last_reviewed, owner), carries a status
# value outside its layer's enum (see docs/README.md), or an owner that is not
# an @handle.
#
# Exclusions: node_modules, archives, test artefacts.

set -euo pipefail

REQUIRED_KEYS=("status" "last_reviewed" "owner")
FAIL=0

while IFS= read -r -d '' file; do
  case "$file" in
    *node_modules*|*playwright-report*|*test-results*|*.pytest_cache*|*backend/alembic/versions/archive*|*docs/superpowers/specs/archive*|*docs/superpowers/plans/archive*|*docs/superpowers/quality-runs*) continue ;;
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

  # --- value checks: status enum (scoped by layer) + owner format ---
  status_val="$(awk '/^---$/{c++; next} c==1 && /^status:/{sub(/^status:[[:space:]]*/,""); print; exit}' "$file")"
  owner_val="$(awk '/^---$/{c++; next} c==1 && /^owner:/{sub(/^owner:[[:space:]]*/,""); print; exit}' "$file")"
  case "$file" in
    docs/adr/*) allowed_status="proposed accepted rejected deprecated superseded template" ;;
    docs/superpowers/specs/*|docs/superpowers/plans/*) allowed_status="draft approved in_progress shipped superseded frozen" ;;
    *) allowed_status="stable draft deprecated" ;;
  esac
  if [[ -n "$status_val" && " $allowed_status " != *" $status_val "* ]]; then
    echo "BAD status '${status_val}' (layer allows: ${allowed_status}): $file"
    FAIL=1
  fi
  owner_re="^'?@[A-Za-z0-9_-]+'?$"
  if [[ -n "$owner_val" && ! "$owner_val" =~ $owner_re ]]; then
    echo "BAD owner '${owner_val}' (want an @handle): $file"
    FAIL=1
  fi
done < <(git ls-files -z '*.md')

if [[ $FAIL -ne 0 ]]; then
  echo
  echo "Frontmatter check FAILED. See docs/adr/0001-use-madr.md (or docs/README.md) for the required format."
  exit 1
fi

echo "Frontmatter check passed for all tracked docs."

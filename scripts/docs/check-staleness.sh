#!/usr/bin/env bash
# Warn (exit 0) if any doc's last_reviewed date is older than the threshold (default 180 days).
# Set STALENESS_THRESHOLD_DAYS to override. Set STALENESS_FAIL=1 to make stale docs a hard error.

set -euo pipefail

THRESHOLD="${STALENESS_THRESHOLD_DAYS:-180}"
FAIL_ON_STALE="${STALENESS_FAIL:-0}"
NOW_EPOCH=$(date -u +%s)
STALE_COUNT=0

while IFS= read -r -d '' file; do
  case "$file" in
    *node_modules*|*archive*|*playwright-report*|*test-results*) continue ;;
  esac

  reviewed=$(awk '/^---$/{c++; next} c==1 && /^last_reviewed:/ { print $2; exit }' "$file" | tr -d '"' | tr -d "'")
  [[ -z "$reviewed" ]] && continue

  if ! reviewed_epoch=$(date -j -f "%Y-%m-%d" "$reviewed" +%s 2>/dev/null); then
    if ! reviewed_epoch=$(date -d "$reviewed" +%s 2>/dev/null); then
      echo "BAD DATE '$reviewed': $file"; continue
    fi
  fi

  age_days=$(( (NOW_EPOCH - reviewed_epoch) / 86400 ))
  if (( age_days > THRESHOLD )); then
    echo "STALE (${age_days}d > ${THRESHOLD}d): $file"
    STALE_COUNT=$(( STALE_COUNT + 1 ))
  fi
done < <(git ls-files -z '*.md' 'llms.txt')

echo
echo "$STALE_COUNT doc(s) older than ${THRESHOLD} days."

if [[ "$FAIL_ON_STALE" == "1" && $STALE_COUNT -gt 0 ]]; then
  exit 1
fi

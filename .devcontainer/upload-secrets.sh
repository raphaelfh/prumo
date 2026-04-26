#!/usr/bin/env bash
# Bulk-upload Codespaces secrets from a local env file using `gh`.
#
# Usage:
#   .devcontainer/upload-secrets.sh                       # uses .devcontainer/secrets.local.env
#   .devcontainer/upload-secrets.sh path/to/file.env
#   SCOPE=user .devcontainer/upload-secrets.sh            # user-level (default: repo-level)
#
# Requires: gh CLI authenticated (`gh auth login`) with the `codespace` scope.
# The env file must NEVER be committed (already covered by .gitignore: **/.env*).
set -euo pipefail

FILE="${1:-.devcontainer/secrets.local.env}"
SCOPE="${SCOPE:-repo}"  # repo | user

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not installed (https://cli.github.com)" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "ERROR: $FILE not found." >&2
  echo "Create it from .devcontainer/secrets.local.env.example and fill in your values." >&2
  exit 1
fi

REPO=""
if [ "$SCOPE" = "repo" ]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
  echo "==> Uploading Codespaces secrets to repo: $REPO"
else
  echo "==> Uploading Codespaces secrets at user level"
fi

count=0
while IFS= read -r line || [ -n "$line" ]; do
  # Skip blanks and comments
  [[ -z "${line// }" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  key="${line%%=*}"
  val="${line#*=}"
  # Strip surrounding quotes
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"

  [[ -z "$key" || "$key" == "$line" ]] && continue
  if [ -z "$val" ]; then
    echo "  - $key: empty, skipping"
    continue
  fi

  if [ "$SCOPE" = "repo" ]; then
    printf '%s' "$val" | gh secret set "$key" --app codespaces --repo "$REPO" --body -
  else
    printf '%s' "$val" | gh secret set "$key" --user --body -
  fi
  echo "  + $key"
  count=$((count + 1))
done < "$FILE"

echo "==> Uploaded $count secret(s). Rebuild your codespace to pick them up."

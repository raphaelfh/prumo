#!/usr/bin/env bash
# Upload Codespaces secrets without maintaining a separate file.
# For each secret in SECRETS, the value is resolved from (first match wins):
#   1. Process environment    (export DATABASE_URL=... before running)
#   2. backend/.env           (your existing local backend config)
#   3. .env                   (your existing local frontend config)
#   4. Optional file passed as $1
#
# Requires: gh CLI authenticated with the `codespace` scope
#   gh auth refresh -s codespace
set -euo pipefail

SECRETS=(
  DATABASE_URL
  DIRECT_DATABASE_URL
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  OPENAI_API_KEY
  OPENAI_DEFAULT_MODEL
  ENCRYPTION_KEY
)

EXTRA_FILE="${1:-}"
SCOPE="${SCOPE:-repo}"   # repo | user

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not installed" >&2; exit 1
fi

read_var_from_file() {
  local file="$1" var="$2" line val
  [ -f "$file" ] || return 1
  line=$(grep -E "^[[:space:]]*${var}=" "$file" | head -1) || return 1
  [ -z "$line" ] && return 1
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

resolve() {
  local var="$1" v
  v="${!var:-}"
  [ -n "$v" ] && { printf '%s' "$v"; return 0; }
  for f in backend/.env .env "$EXTRA_FILE"; do
    [ -z "$f" ] && continue
    v=$(read_var_from_file "$f" "$var" 2>/dev/null || true)
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
  done
  return 1
}

if [ "$SCOPE" = "repo" ]; then
  REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
  echo "==> Uploading Codespaces secrets to repo: $REPO"
else
  REPO=""
  echo "==> Uploading Codespaces secrets at user level"
fi

count=0
skipped=()
for var in "${SECRETS[@]}"; do
  if val=$(resolve "$var") && [ -n "$val" ]; then
    # Reject obviously-placeholder values that would break the codespace.
    if [[ "$val" == *"<"*">"* || "$val" == "your_"* || "$val" == "sk-your-"* ]]; then
      echo "  ! $var: looks like a placeholder, skipping"
      skipped+=("$var")
      continue
    fi
    if [ "$SCOPE" = "repo" ]; then
      printf '%s' "$val" | gh secret set "$var" --app codespaces --repo "$REPO" --body -
    else
      printf '%s' "$val" | gh secret set "$var" --user --body -
    fi
    echo "  + $var"
    count=$((count + 1))
  else
    echo "  - $var: not found in env / backend/.env / .env${EXTRA_FILE:+ / $EXTRA_FILE} (skipping)"
    skipped+=("$var")
  fi
done

echo "==> Uploaded $count secret(s)"
if [ "${#skipped[@]}" -gt 0 ]; then
  echo "==> Skipped: ${skipped[*]}"
  echo "    Provide them via shell env, backend/.env, .env, or as a file argument."
fi

#!/usr/bin/env bash
# =============================================================================
# check_migration_split.sh
# =============================================================================
# Thin wrapper around scripts/validate_migration_boundaries.sh so the fitness
# harness invokes one canonical implementation. Forwards args + exit code.
#
# Invariant enforced: Alembic only edits public.*; Supabase CLI owns auth.*
# and storage.* (see docs/architecture/migrations.md).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/../validate_migration_boundaries.sh" "$@"

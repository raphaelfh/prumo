# shellcheck shell=bash
# Sourced by the sandboxed shell tests (scripts/tests/test-ship.sh and
# .claude/hooks/tests/test-*.sh). Builds their throwaway repo and refuses any
# git call that would land outside it.
#
# Why: `SANDBOX=$(mktemp -d)` fails silently under a restricted TMPDIR (seen
# under the Claude Code macOS sandbox). An empty $SANDBOX turns
# `git -C "$SANDBOX" ...` into a git call on the CALLER's checkout, and
# `cd "" && pwd -P` resolves to the caller's cwd, so the EXIT trap's
# `rm -rf "$SANDBOX"` deleted the checkout. test-scratch-guard.sh pins this.

# scratch_mkdir <prefix>: sets SANDBOX to a fresh physical directory and
# removes it on exit, or exits 1 before anything else runs.
scratch_mkdir() {
  SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/$1.XXXXXX" 2>/dev/null) || SANDBOX=""
  if [ -z "$SANDBOX" ] || [ ! -d "$SANDBOX" ]; then
    echo "scratch: mktemp failed (TMPDIR=${TMPDIR:-unset}); refusing to run" >&2
    exit 1
  fi
  # Physical path: macOS mktemp hands back /var/... while git resolves
  # /private/var/..., and every toplevel comparison below needs git's form.
  SANDBOX=$(cd "$SANDBOX" && pwd -P) || SANDBOX=""
  if [ -z "$SANDBOX" ] || [ ! -d "$SANDBOX" ]; then
    echo "scratch: cannot resolve the scratch directory; refusing to run" >&2
    exit 1
  fi
  trap 'rm -rf "$SANDBOX"' EXIT
}

_scratch_inside() { # $1 = dir → exits unless it is $SANDBOX or below it
  case "$1/" in
    "$SANDBOX"/*) ;;
    *) echo "scratch: '$1' is outside the scratch dir '$SANDBOX'; refusing" >&2; exit 1 ;;
  esac
}

# scratch_init <dir>: `git init` a scratch repo at <dir> (under $SANDBOX) and
# verify git resolves <dir> itself as its toplevel.
scratch_init() {
  _scratch_inside "$1"
  mkdir -p "$1" && git -C "$1" init -q || exit 1
  sgit "$1" rev-parse --git-dir >/dev/null
}

# sgit <dir> <git args...>: git -C <dir>, only when <dir> is the toplevel of a
# scratch repo under $SANDBOX. A bad path can never reach another checkout.
sgit() {
  local dir=$1 top
  shift
  _scratch_inside "$dir"
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || top=""
  if [ "$top" != "$dir" ]; then
    echo "scratch: '$dir' resolves to repo '${top:-<none>}', not a scratch repo; refusing git $*" >&2
    exit 1
  fi
  git -C "$dir" "$@"
}

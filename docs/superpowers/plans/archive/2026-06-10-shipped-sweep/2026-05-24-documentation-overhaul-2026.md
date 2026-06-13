---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
supersedes: null
shipped_on: '2026-05-24'
---

# Documentation Overhaul 2026 — Implementation Plan

> **Status:** Shipped 2026-05-24 · Last reviewed: 2026-05-24 · Owner: @raphaelfh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every Markdown surface of the prumo repository up to a coherent 2026 documentation standard — single language (English), Diátaxis-organised, link-checked in CI, with retroactive ADRs, status frontmatter on every doc, a consolidated spec surface, and zero references to retired infrastructure (Render).

**Architecture:** Eleven sequential phases. **Phase 0 installs CI gates first** so every later phase is validated automatically (no drift creeps in mid-overhaul). Phases 1–4 do mechanical cleanup (delete, move, archive). Phases 5–7 rewrite content. Phases 8–10 introduce new structure (Diátaxis tree, ADRs, llms.txt, ROADMAP migration). Phase 11 is a hard verification gate before declaring done.

**Tech Stack:** Markdown · `lychee` (link checker) · `markdownlint-cli2` · `cspell` · GitHub Actions · MADR 4.0 (ADR template) · Diátaxis framework · YAML frontmatter.

**Decisions baked in (from brainstorm 2026-05-24):**

1. **Language:** English everywhere. PT-BR removed from all canonical docs.
2. **Spec surfaces:** `docs/superpowers/` is canonical going forward. Legacy `specs/00X/` archived under `docs/superpowers/specs/archive/legacy-spec-kit/`.
3. **Community files:** `.github/` is canonical; root keeps only `README.md` + `LICENSE`.
4. **Roadmap:** Migrated to GitHub Projects; `docs/ROADMAP.md` becomes a thin pointer with top-level milestones.
5. **License:** `LICENSE.txt` deleted; `LICENSE` is canonical.
6. **CHARMS:** Real version is v1.1.0 (per 2026-05-17 split). DB verification task added to confirm before rewriting docs.
7. **ux_template/:** Renamed to `docs/design-references/` with a proper README.
8. **Diátaxis:** Adopted now, full migration with cross-reference updates.
9. **ADRs:** 5 retroactive ADRs (Alembic split, kind discriminator, Render→Railway, AGPL, quality autoloop) + MADR template.
10. **CI lint stack:** `lychee` + `markdownlint-cli2` + `cspell`.
11. **specs/007:** Cancelled placeholder created under archive.
12. **Status badge:** Frontmatter YAML + visible line on every doc.

**Scope guarantee:** No corner-cutting. Every file flagged in the 2026-05-24 audit gets a task. Every cross-reference is updated. Every broken link is fixed (or the target restored). Every duplicate is resolved. The final verification phase fails if any of these are still present.

**Open questions left for execution time:** Tasks marked `🛑 DECISION` pause the executor to ask the user a clarifying question (e.g. exact GitHub Project URL, real CHARMS version from DB, content of `docs/legal/CLA.md`).

---

## File Map (what gets created, moved, deleted)

### To delete

- `LICENSE.txt` (redundant with `LICENSE`)
- `docs/legal/CODE_OF_CONDUCT.md` (stub)
- `docs/legal/SECURITY.md` (stub)
- `.github/CONTRIBUTING.md` (stub — `.github/` becomes canonical, so the stub stops existing)
- `docs/estrutura_database/` (entire folder — both files are stubs pointing elsewhere)
- `docs/planos/` (entire folder — ROADMAP migrated)
- `docs/templates/` (entire folder — CHARMS doc relocates to `docs/reference/templates/`)
- `docs/ux_template/` (renamed to `docs/design-references/`)
- `playwright-report/` (tracked artefacts — moved to `.gitignore`)
- `test-results/` (tracked artefacts — moved to `.gitignore`)

### To move (`git mv` preserves history)

| From | To | Reason |
|---|---|---|
| `CODE_OF_CONDUCT.md` | `.github/CODE_OF_CONDUCT.md` | Community files convention |
| `SECURITY.md` | `.github/SECURITY.md` | Community files convention |
| `CONTRIBUTING.md` | `.github/CONTRIBUTING.md` | Community files convention (replaces existing stub) |
| `docs/architecture/deployment.md` | `docs/reference/deployment.md` | Diátaxis reference |
| `docs/architecture/extraction-hitl-architecture.md` | `docs/reference/extraction-hitl-architecture.md` | Diátaxis reference |
| `docs/architecture/migrations.md` | `docs/reference/migrations.md` | Diátaxis reference |
| `docs/architecture/test-strategy.md` | `docs/reference/test-strategy.md` | Diátaxis reference |
| `docs/DATABASE_SEEDING.md` | `docs/how-to/seed-database.md` | Diátaxis how-to |
| `docs/extraction-e2e-observability.md` | `docs/how-to/observability-extraction.md` | Diátaxis how-to |
| `docs/templates/CHARMS_2.0_COMPLETE_TEMPLATE.md` | `docs/reference/templates/charms-v1.1-complete.md` | Diátaxis + version fix |
| `docs/templates/CHARMS_2.0_HIERARQUIA_VISUAL.md` | `docs/reference/templates/charms-v1.1-hierarchy.md` | Diátaxis + version fix + EN |
| `docs/ux_template/*.png` | `docs/design-references/*.png` | Self-describing folder name |
| `specs/001-alembic-migrations/` | `docs/superpowers/specs/archive/legacy-spec-kit/001-alembic-migrations/` | Single spec surface |
| `specs/002-ai-assessment-flow/` | `docs/superpowers/specs/archive/legacy-spec-kit/002-ai-assessment-flow/` | Single spec surface |
| `specs/003-fix-assessment-sync/` | `docs/superpowers/specs/archive/legacy-spec-kit/003-fix-assessment-sync/` | Single spec surface |
| `specs/004-frontend-i18n/` | `docs/superpowers/specs/archive/legacy-spec-kit/004-frontend-i18n/` | Single spec surface |
| `specs/005-articles-export/` | `docs/superpowers/specs/archive/legacy-spec-kit/005-articles-export/` | Single spec surface |
| `specs/006-zotero-articles-sync/` | `docs/superpowers/specs/archive/legacy-spec-kit/006-zotero-articles-sync/` | Single spec surface |
| `specs/008-unified-evaluation-model/` | `docs/superpowers/specs/archive/legacy-spec-kit/008-unified-evaluation-model/` | Cancelled — stack dropped 2026-04-27 |
| `specs/009-extraction-excel-export/` | `docs/superpowers/specs/archive/legacy-spec-kit/009-extraction-excel-export/` | Single spec surface |
| `docs/superpowers/plans/2026-05-24-render-to-railway-migration.md` | `docs/superpowers/plans/archive/2026-05-24-render-to-railway/plan.md` | Already shipped |

### To create

- `.github/markdownlint.json` — markdownlint-cli2 config
- `.github/lychee.toml` — link checker config
- `.github/cspell.json` — spell checker config + project dictionary
- `.github/workflows/docs-ci.yml` — runs the three linters on `**/*.md` changes
- `.github/PULL_REQUEST_TEMPLATE.md` — verify and reinforce (already exists, refresh)
- `.github/SUPPORT.md` — points to issue templates + discussions
- `docs/README.md` — site map / index
- `docs/tutorials/.gitkeep` — Diátaxis quadrant (empty for now, ready for future)
- `docs/how-to/.gitkeep` — Diátaxis quadrant (will hold seed-database.md, observability-extraction.md)
- `docs/reference/.gitkeep` — Diátaxis quadrant
- `docs/explanation/.gitkeep` — Diátaxis quadrant
- `docs/adr/0000-template.md` — MADR template
- `docs/adr/0001-use-madr.md` — meta ADR
- `docs/adr/0002-split-alembic-supabase-ownership.md` — retroactive ADR
- `docs/adr/0003-kind-discriminator-for-hitl.md` — retroactive ADR
- `docs/adr/0004-hosting-render-to-railway.md` — retroactive ADR
- `docs/adr/0005-license-agpl-3.0.md` — retroactive ADR
- `docs/adr/0006-quality-autoloop-as-development-practice.md` — retroactive ADR
- `docs/design-references/README.md` — describes the Linear references
- `docs/superpowers/specs/archive/legacy-spec-kit/README.md` — archive index
- `docs/superpowers/specs/archive/legacy-spec-kit/007-cancelled-placeholder.md` — explains the gap
- `docs/ROADMAP.md` — thin pointer to GitHub Projects
- `llms.txt` — entry point for AI agents (emerging standard)
- `scripts/docs/check-frontmatter.sh` — verifies every doc has the required frontmatter
- `scripts/docs/check-staleness.sh` — flags docs with `last_reviewed` > 180 days old

### To rewrite (full overhaul, English, accurate)

- `README.md` (root)
- `backend/README.md`
- `frontend/e2e/README.md` (status check + minor refresh)
- `frontend/pdf-viewer/README.md` (status check + minor refresh)
- `scripts/fitness/README.md` (status check)
- `CLAUDE.md` (refresh after reorg)
- `.claude/CLAUDE.md` (refresh after reorg)
- `.specify/memory/constitution.md` (path refresh only)

### To update inline (already EN, but needs render.yaml refs and frontmatter)

- `docs/reference/extraction-hitl-architecture.md` (drop render.yaml mention)
- `docs/reference/deployment.md` (verify render-free, add frontmatter)
- `docs/reference/migrations.md` (add frontmatter)
- `docs/reference/test-strategy.md` (add frontmatter)
- `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` (add frozen banner + frontmatter)
- `docs/superpowers/specs/2026-04-27-sidebar-revitalization-design.md` (frontmatter)
- `docs/superpowers/specs/2026-04-28-pdf-viewer-database-requirements.md` (frontmatter)
- `docs/superpowers/specs/2026-05-03-screening-and-imports-design.md` (frontmatter)
- `docs/superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md` (frontmatter)
- `docs/superpowers/specs/2026-05-22-dark-light-ux-tokenization-design.md` (frontmatter)
- `docs/superpowers/specs/2026-05-22-preflight-slash-command-design.md` (frontmatter)
- `docs/superpowers/plans/*.md` (active plans get frontmatter)
- `docs/superpowers/quality-runs/README.md` (frontmatter)
- `docs/superpowers/design-system/sidebar-and-panels.md` (frontmatter)

---

## Phase 0 — Install CI Gates First

> **Why first:** every later phase moves, renames, and rewrites. Without lint gates the executor has no automated feedback that internal links still resolve and frontmatter is consistent. By installing the gates first, every later `git commit` either passes or fails the same checks that will run in CI.

### Task 0.1 — Add `markdownlint-cli2` config

**Files:**
- Create: `.github/markdownlint.json`

- [ ] **Step 1: Create the config**

Write `.github/markdownlint.json`:

```json
{
  "default": true,
  "MD003": { "style": "atx" },
  "MD004": { "style": "dash" },
  "MD007": { "indent": 2 },
  "MD013": false,
  "MD024": { "siblings_only": true },
  "MD025": { "front_matter_title": "" },
  "MD033": { "allowed_elements": ["br", "details", "summary", "sub", "sup"] },
  "MD041": false,
  "MD046": { "style": "fenced" }
}
```

- [ ] **Step 2: Install dev dependency locally for ad-hoc runs**

Run: `npm install --save-dev markdownlint-cli2`

Expected: `package.json` updated; `node_modules/.bin/markdownlint-cli2` exists.

- [ ] **Step 3: Run against the repo (baseline)**

Run: `npx markdownlint-cli2 "**/*.md" "!node_modules/**" "!playwright-report/**" "!test-results/**" "!**/.pytest_cache/**"`

Expected: A list of violations. Capture the count in the commit body — this is the baseline; later phases bring it to zero.

- [ ] **Step 4: Commit**

```bash
git add .github/markdownlint.json package.json package-lock.json
git commit -m "chore(docs): add markdownlint config (baseline: <N> violations)"
```

### Task 0.2 — Add `lychee` config for link checking

**Files:**
- Create: `.github/lychee.toml`

- [ ] **Step 1: Create the config**

Write `.github/lychee.toml`:

```toml
# https://lychee.cli.rs/usage/config/
max_redirects = 5
timeout = 30
max_concurrency = 16
accept = [200, 206, 429]
exclude_path = [
  "node_modules",
  "playwright-report",
  "test-results",
  ".pytest_cache",
  ".venv",
  "dist",
  "backend/alembic/versions/archive",
]
exclude = [
  "^https?://localhost",
  "^https?://127\\.0\\.0\\.1",
  "^https?://0\\.0\\.0\\.0",
  "^https?://.*\\.local",
  "^https?://web-production-48b398\\.up\\.railway\\.app",
  "^https?://prumo-alpha\\.vercel\\.app",
]
verbose = "info"
no_progress = true
```

- [ ] **Step 2: Run lychee against the repo (baseline)**

Run: `docker run --rm -v "$PWD:/input" lycheeverse/lychee --config /input/.github/lychee.toml /input`

Expected: A list of broken links. Capture the count. This will include README's `docs/guias/*` and `docs/tecnicas/*` ghosts — they are knowingly broken and will be fixed in Phase 5.

- [ ] **Step 3: Commit**

```bash
git add .github/lychee.toml
git commit -m "chore(docs): add lychee link-checker config (baseline: <N> broken)"
```

### Task 0.3 — Add `cspell` config + project dictionary

**Files:**
- Create: `.github/cspell.json`
- Create: `.github/cspell-words.txt`

- [ ] **Step 1: Create the spell-checker config**

Write `.github/cspell.json`:

```json
{
  "version": "0.2",
  "language": "en",
  "dictionaryDefinitions": [
    { "name": "prumo", "path": "./cspell-words.txt", "addWords": true }
  ],
  "dictionaries": ["prumo"],
  "ignorePaths": [
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    ".pytest_cache/**",
    "**/*.lock",
    "**/*.svg",
    "**/.venv/**",
    "**/dist/**",
    "backend/alembic/versions/archive/**"
  ],
  "files": ["**/*.md"]
}
```

- [ ] **Step 2: Seed the project dictionary**

Write `.github/cspell-words.txt`:

```text
alembic
asyncpg
celery
cspell
diátaxis
extractor
finalised
finalize
finalized
fluidcompute
fluid
gunicorn
hitl
hono
isr
linter
lychee
madr
markdownlint
microvm
microvms
msw
nuxt
podman
postgres
probast
prumo
quadas
quickstart
railway
raphaelfh
rastreabilidade
ratchet
ratcheted
ratcheting
rls
ruff
sastrugi
scoping
sqlalchemy
structlog
supabase
sveltekit
tanstack
tomlsort
toctou
trace
trace_id
tripod
tsx
turbopack
uvicorn
vercel
vite
vitest
workos
zotero
```

- [ ] **Step 3: Run cspell (baseline)**

Run: `npx -y cspell --config .github/cspell.json "**/*.md"`

Expected: A list of unknown words. Add genuine domain terms to `cspell-words.txt`; everything else is a real typo to fix in later phases. Capture baseline.

- [ ] **Step 4: Commit**

```bash
git add .github/cspell.json .github/cspell-words.txt
git commit -m "chore(docs): add cspell config + project dictionary (baseline: <N> unknowns)"
```

### Task 0.4 — Add `scripts/docs/check-frontmatter.sh`

**Files:**
- Create: `scripts/docs/check-frontmatter.sh`

- [ ] **Step 1: Write the script**

Write `scripts/docs/check-frontmatter.sh`:

```bash
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
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/docs/check-frontmatter.sh`

- [ ] **Step 3: Run it (baseline — will fail noisy)**

Run: `bash scripts/docs/check-frontmatter.sh || true`

Expected: A long list of files missing frontmatter. This is the gap Phases 5–10 close.

- [ ] **Step 4: Commit**

```bash
git add scripts/docs/check-frontmatter.sh
git commit -m "chore(docs): add frontmatter validator script"
```

### Task 0.5 — Add `scripts/docs/check-staleness.sh`

**Files:**
- Create: `scripts/docs/check-staleness.sh`

- [ ] **Step 1: Write the script**

Write `scripts/docs/check-staleness.sh`:

```bash
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
done < <(git ls-files -z '*.md')

echo
echo "$STALE_COUNT doc(s) older than ${THRESHOLD} days."

if [[ "$FAIL_ON_STALE" == "1" && $STALE_COUNT -gt 0 ]]; then
  exit 1
fi
```

- [ ] **Step 2: Make executable + run**

Run: `chmod +x scripts/docs/check-staleness.sh && bash scripts/docs/check-staleness.sh`

Expected: Most docs have no frontmatter yet → not flagged. After Phase 11 the gate becomes meaningful.

- [ ] **Step 3: Commit**

```bash
git add scripts/docs/check-staleness.sh
git commit -m "chore(docs): add staleness-warning script (warns at 180d by default)"
```

### Task 0.6 — Wire the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/docs-ci.yml`

- [ ] **Step 1: Write the workflow**

Write `.github/workflows/docs-ci.yml`:

```yaml
name: docs-ci

on:
  pull_request:
    paths:
      - '**/*.md'
      - '.github/markdownlint.json'
      - '.github/lychee.toml'
      - '.github/cspell.json'
      - '.github/cspell-words.txt'
      - 'scripts/docs/**'
      - '.github/workflows/docs-ci.yml'
  push:
    branches: [main]
    paths:
      - '**/*.md'

permissions:
  contents: read
  issues: write

jobs:
  markdownlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npx -y markdownlint-cli2 "**/*.md" "!node_modules/**" "!playwright-report/**" "!test-results/**" "!**/.pytest_cache/**" "!backend/alembic/versions/archive/**"

  cspell:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npx -y cspell --config .github/cspell.json "**/*.md"

  links:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lycheeverse/lychee-action@v2
        with:
          args: '--config .github/lychee.toml .'
          fail: true

  frontmatter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/docs/check-frontmatter.sh

  staleness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: STALENESS_FAIL=0 bash scripts/docs/check-staleness.sh
```

- [ ] **Step 2: Validate YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/docs-ci.yml'))" && echo OK`

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docs-ci.yml
git commit -m "ci(docs): run markdownlint, cspell, lychee, frontmatter and staleness on Markdown PRs"
```

> **Note:** the workflow may fail on the very next PR until Phase 11 closes all baseline issues. That is intentional — the gate is what forces the overhaul to actually complete.

---

## Phase 1 — Triage (Quick Wins, No Conflicts)

### Task 1.1 — Delete `LICENSE.txt`

**Files:**
- Delete: `LICENSE.txt`

- [ ] **Step 1: Verify `LICENSE` is the full AGPL-3.0 text**

Run: `wc -l LICENSE && head -3 LICENSE`

Expected: 651 lines; starts with `GNU AFFERO GENERAL PUBLIC LICENSE`.

- [ ] **Step 2: Delete the redundant file**

Run: `git rm LICENSE.txt`

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: drop redundant LICENSE.txt (LICENSE is canonical AGPL-3.0 text)"
```

### Task 1.2 — Drop tracked Playwright artefacts and ignore them

**Files:**
- Modify: `.gitignore`
- Delete (tracked copies): `playwright-report/`, `test-results/`

- [ ] **Step 1: Add ignore entries**

Edit `.gitignore` — add these lines under a new `# Test artefacts` section if not already present:

```
# Test artefacts
playwright-report/
test-results/
```

- [ ] **Step 2: Remove tracked copies (keep on disk for local triage)**

Run:

```bash
git rm -r --cached playwright-report test-results 2>/dev/null || true
```

- [ ] **Step 3: Verify**

Run: `git status --short | grep -E '(playwright-report|test-results)' | head`

Expected: only `D ` (deletions) for the previously tracked entries; no `??` (new untracked) entries because of the ignore rules.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: stop tracking playwright-report and test-results artefacts"
```

### Task 1.3 — Archive the Render→Railway plan (shipped)

**Files:**
- Move: `docs/superpowers/plans/2026-05-24-render-to-railway-migration.md` → `docs/superpowers/plans/archive/2026-05-24-render-to-railway/plan.md`
- Create: `docs/superpowers/plans/archive/2026-05-24-render-to-railway/README.md`

- [ ] **Step 1: Create the archive folder and move the plan**

Run:

```bash
mkdir -p docs/superpowers/plans/archive/2026-05-24-render-to-railway
git mv docs/superpowers/plans/2026-05-24-render-to-railway-migration.md \
       docs/superpowers/plans/archive/2026-05-24-render-to-railway/plan.md
```

- [ ] **Step 2: Add an archive README**

Write `docs/superpowers/plans/archive/2026-05-24-render-to-railway/README.md`:

```markdown
---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Archived: 2026-05-24 Render → Railway migration

> **Status:** Shipped 2026-05-24. Frozen — do not edit.

This plan moved backend hosting from Render to Railway. Web (FastAPI + gunicorn),
Celery worker, and managed Redis on the Hobby plan, US East region.

For the **current architecture**, see [`docs/reference/deployment.md`](../../../../reference/deployment.md).

The `render.yaml` file referenced throughout the plan was deleted as part of the
Cleanup phase (E). No further action required.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/archive/2026-05-24-render-to-railway/
git commit -m "docs(superpowers): archive shipped Render→Railway plan"
```

### Task 1.4 — Investigate the `specs/007` gap

**Files:**
- (Read-only investigation; output drives Task 4.5)

- [ ] **Step 1: Search git history**

Run:

```bash
git log --all --diff-filter=D --name-only --format='%H %s' -- 'specs/007*' 2>&1 | head -50
git log --all --grep='007' --grep='spec.*007' --oneline | head -20
```

- [ ] **Step 2: Document findings inline in this plan**

If `git log` shows `specs/007-…` ever existed, capture the slug + the commit that deleted it. If it never existed, note that the number was reserved but never materialised.

🛑 **DECISION (only if git history is inconclusive):** Ask the user "Do you remember what spec 007 was meant to be?" — Task 4.5 needs either a name + reason, or the "reserved-never-used" verdict, before writing the placeholder.

- [ ] **Step 3: No commit (investigation only)**

### Task 1.5 — 🛑 DECISION: Verify CHARMS version in the database

**Files:**
- (Read-only verification; output drives Tasks 7.1–7.3)

- [ ] **Step 1: Query the live database**

Run (against local Supabase or prod, whichever is the source of truth):

```bash
psql "$DATABASE_URL" -c "SELECT name, version, framework FROM extraction_templates_global WHERE framework='CHARMS';"
```

- [ ] **Step 2: Reconcile with CLAUDE.md / DATABASE_SEEDING.md**

Expected per `CLAUDE.md` 2026-05-17 entry: `v1.1.0` after the study-level / per-model split.

🛑 **DECISION**: If the DB shows a version different from `1.1.0`, pause and ask the user which is the source of truth before Tasks 7.1–7.3 rewrite the template doc.

- [ ] **Step 3: Document verdict in commit message of Task 7.1**

---

## Phase 2 — Community Files → `.github/`

> **Why:** GitHub auto-detects community files in either the repo root or `.github/`. Consolidating in `.github/` keeps the root clean (only `README.md` + `LICENSE` remain) and matches the dominant 2025–2026 convention.

### Task 2.1 — Move `CODE_OF_CONDUCT.md`

**Files:**
- Move: `CODE_OF_CONDUCT.md` → `.github/CODE_OF_CONDUCT.md`
- Delete: `docs/legal/CODE_OF_CONDUCT.md` (existing "moved" stub)

- [ ] **Step 1: Move the canonical file**

Run: `git mv CODE_OF_CONDUCT.md .github/CODE_OF_CONDUCT.md`

- [ ] **Step 2: Delete the stub in `docs/legal/`**

Run: `git rm docs/legal/CODE_OF_CONDUCT.md`

- [ ] **Step 3: Update inbound references**

Search and replace `CODE_OF_CONDUCT.md` references (root and stub):

Run: `grep -rln "CODE_OF_CONDUCT" --include='*.md' . | grep -v node_modules`

For each hit, ensure the link points to `.github/CODE_OF_CONDUCT.md` (relative to the linking file). Use the Edit tool one file at a time.

- [ ] **Step 4: Commit**

```bash
git add .github/CODE_OF_CONDUCT.md docs/legal/CODE_OF_CONDUCT.md
git commit -m "docs: move CODE_OF_CONDUCT.md to .github/ (community files convention)"
```

### Task 2.2 — Move `SECURITY.md`

**Files:**
- Move: `SECURITY.md` → `.github/SECURITY.md`
- Delete: `docs/legal/SECURITY.md` (stub)

- [ ] **Step 1: Move + delete + update references**

```bash
git mv SECURITY.md .github/SECURITY.md
git rm docs/legal/SECURITY.md
grep -rln "SECURITY.md" --include='*.md' . | grep -v node_modules | grep -v .github/SECURITY.md
# For each remaining hit, update path with Edit tool.
```

- [ ] **Step 2: Commit**

```bash
git add .github/SECURITY.md docs/legal/SECURITY.md
git commit -m "docs: move SECURITY.md to .github/ (community files convention)"
```

### Task 2.3 — Move `CONTRIBUTING.md` (and delete the stub in `.github/`)

**Files:**
- Move: `CONTRIBUTING.md` → `.github/CONTRIBUTING.md`
- Delete (existing stub): `.github/CONTRIBUTING.md` is replaced by the canonical content

- [ ] **Step 1: Delete the existing `.github/CONTRIBUTING.md` stub first**

Run: `git rm .github/CONTRIBUTING.md`

- [ ] **Step 2: Move the canonical file**

Run: `git mv CONTRIBUTING.md .github/CONTRIBUTING.md`

- [ ] **Step 3: Update inbound references (README, others)**

Run: `grep -rln "CONTRIBUTING.md" --include='*.md' . | grep -v node_modules`

Update each link to `.github/CONTRIBUTING.md`.

- [ ] **Step 4: Commit**

```bash
git add .github/CONTRIBUTING.md
git commit -m "docs: move CONTRIBUTING.md to .github/ (community files convention)"
```

### Task 2.4 — 🛑 DECISION: `docs/legal/CLA.md`

**Files:**
- Read: `docs/legal/CLA.md`

- [ ] **Step 1: Inspect**

Run: `cat docs/legal/CLA.md | head -50`

- [ ] **Step 2: Decide**

If it is a real Contributor Licence Agreement: move to `.github/CLA.md` and add a one-line link from `.github/CONTRIBUTING.md`. If it is an unused stub: `git rm docs/legal/CLA.md` and delete the now-empty `docs/legal/` directory.

🛑 **DECISION**: ask the user "Are we actively using a CLA? If yes, move it to `.github/CLA.md`; if no, delete it." before committing.

- [ ] **Step 3: After decision, commit**

```bash
git add .github/CLA.md docs/legal/CLA.md   # whichever changed
git rm -r docs/legal/                       # if all removed
git commit -m "docs: <action> docs/legal/CLA.md"
```

### Task 2.5 — Add `.github/SUPPORT.md`

**Files:**
- Create: `.github/SUPPORT.md`

- [ ] **Step 1: Write the file**

Write `.github/SUPPORT.md`:

```markdown
# Support

If you have a question, please use one of these channels — **do not** open a security issue or a code-defect bug just to ask a question.

- **Bug reports & feature requests:** use the [issue templates](./ISSUE_TEMPLATE).
- **Open-ended questions:** use the [Q&A discussion forum](https://github.com/raphaelfh/prumo/discussions/categories/q-a).
- **Security vulnerabilities:** see [`SECURITY.md`](./SECURITY.md). Do not report security issues in public issues or discussions.

For internal contributors, also see the [Contributing guide](./CONTRIBUTING.md) and the project's [Code of Conduct](./CODE_OF_CONDUCT.md).
```

- [ ] **Step 2: Commit**

```bash
git add .github/SUPPORT.md
git commit -m "docs: add SUPPORT.md pointing to issue templates and discussions"
```

### Task 2.6 — Refresh `.github/PULL_REQUEST_TEMPLATE.md`

**Files:**
- Read and possibly rewrite: `.github/pull_request_template.md`

- [ ] **Step 1: Inspect current content**

Run: `cat .github/pull_request_template.md`

- [ ] **Step 2: Rewrite if it lacks the required checklist**

If the current template does NOT include all of: linked issue, what changed, how to verify, screenshots for UI, migration safety (RLS / NOT NULL backfills), and a CHANGELOG / docs check — replace with:

```markdown
## Summary

<!-- 1–3 bullet points explaining what changed and why. -->

## Linked issues / specs

<!-- Close with "Closes #N" or link the spec under docs/superpowers/specs/. -->

## How to verify

<!-- Step-by-step commands or UI flow. Include the test account when relevant
     (teste@prumo.local). -->

## Test plan

- [ ] Backend: `make test-backend` passes
- [ ] Frontend: `npm test -- --run` passes
- [ ] E2E (if UI changed): `npx playwright test` passes for the touched flow
- [ ] Lints: `make lint-backend` and `npm run lint` pass

## Migration safety (if applicable)

- [ ] Alembic migration is one logical change per file
- [ ] RLS enabled on new tables and policies created in the same migration
- [ ] `NOT NULL` columns have a defaulted backfill on populated tables
- [ ] Downgrade path tested locally

## Docs

- [ ] Updated relevant doc(s) under `docs/` (reference, how-to, ADR)
- [ ] Touched docs carry up-to-date `last_reviewed` frontmatter
- [ ] No broken cross-references (`docs-ci` link check will catch the rest)

## Screenshots (UI changes only)

| Before | After |
|---|---|
|        |       |
```

- [ ] **Step 3: Commit**

```bash
git add .github/pull_request_template.md
git commit -m "docs(github): refresh PR template with verify/migration/docs checklist"
```

---

## Phase 3 — Diátaxis Skeleton + `docs/README.md` Index

> **Why:** Creating the empty quadrant folders first lets every later phase move content **into a known structure** with predictable redirects. `docs/README.md` becomes the canonical site map.

### Task 3.1 — Create the four Diátaxis quadrants

**Files:**
- Create: `docs/tutorials/.gitkeep`
- Create: `docs/how-to/.gitkeep`
- Create: `docs/reference/.gitkeep`
- Create: `docs/explanation/.gitkeep`

- [ ] **Step 1: Create folders + gitkeeps**

Run:

```bash
mkdir -p docs/tutorials docs/how-to docs/reference docs/explanation
touch docs/tutorials/.gitkeep docs/how-to/.gitkeep docs/reference/.gitkeep docs/explanation/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/.gitkeep docs/how-to/.gitkeep docs/reference/.gitkeep docs/explanation/.gitkeep
git commit -m "docs: scaffold Diátaxis quadrant directories (tutorials/how-to/reference/explanation)"
```

### Task 3.2 — Write `docs/README.md` (index / site map)

**Files:**
- Create: `docs/README.md`

- [ ] **Step 1: Write the file**

Write `docs/README.md`:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Documentation Index

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

This tree follows the [Diátaxis](https://diataxis.fr) framework. Pick the
quadrant that matches what you need.

## Tutorials — *learning by doing*

> Start here if you are new. Each tutorial takes you from zero to a
> known-good outcome.

_None yet — see the root [`README.md`](../README.md) for setup until a real
tutorial lives here._

## How-to guides — *task recipes*

| Guide | When to read |
|---|---|
| [Seed the database](./how-to/seed-database.md) | After `make reset-db` or when bootstrapping a new env |
| [Extraction E2E observability](./how-to/observability-extraction.md) | Debugging extraction latency / errors across browser → API → DB |

## Reference — *information lookup*

| Reference | What's inside |
|---|---|
| [Deployment](./reference/deployment.md) | Topology, env vars, rollback, Railway specifics |
| [Migrations](./reference/migrations.md) | Alembic vs Supabase split, squash recipe, RLS conventions |
| [Extraction + HITL architecture](./reference/extraction-hitl-architecture.md) | Canonical schema, run lifecycle, RLS posture |
| [Test strategy](./reference/test-strategy.md) | Load-bearing tests, pyramid layout |
| [CHARMS template (v1.1)](./reference/templates/charms-v1.1-complete.md) | Field-by-field spec of the global CHARMS template |
| [CHARMS visual hierarchy](./reference/templates/charms-v1.1-hierarchy.md) | Tree view of CHARMS entities |

## Explanation — *understanding the why*

| Doc | What it explains |
|---|---|
| [ADR index](./adr/) | Architecture decisions (MADR 4.0) |
| [Roadmap pointer](./ROADMAP.md) | Active milestones and link to GitHub Projects |

## Internal tooling

| Path | Purpose |
|---|---|
| [`docs/superpowers/specs/`](./superpowers/specs/) | Active design specs |
| [`docs/superpowers/plans/`](./superpowers/plans/) | Active implementation plans |
| [`docs/superpowers/quality-runs/`](./superpowers/quality-runs/) | Outputs of the architectural quality autoloop |
| [`docs/superpowers/design-system/`](./superpowers/design-system/) | Component design briefs |
| [`docs/design-references/`](./design-references/) | Visual references (Linear UX) |

## Community files

| File | Lives in |
|---|---|
| Contributing | [`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) |
| Code of Conduct | [`.github/CODE_OF_CONDUCT.md`](../.github/CODE_OF_CONDUCT.md) |
| Security policy | [`.github/SECURITY.md`](../.github/SECURITY.md) |
| Support | [`.github/SUPPORT.md`](../.github/SUPPORT.md) |

## Doc conventions

- Every file under `docs/` carries YAML frontmatter (`status`, `last_reviewed`, `owner`) and a visible status line at the top.
- Status values: `stable` · `draft` · `deprecated` · `shipped` · `frozen` · `in_progress`.
- CI (`.github/workflows/docs-ci.yml`) enforces markdownlint, cspell, link check, and frontmatter presence on every PR that touches `**/*.md`.
- Docs older than 180 days trigger a `staleness` warning (set `STALENESS_FAIL=1` in CI to harden later).
```

- [ ] **Step 2: Commit**

```bash
git add docs/README.md
git commit -m "docs: add Diátaxis index at docs/README.md"
```

### Task 3.3 — Add `llms.txt` at the repo root

**Files:**
- Create: `llms.txt`

- [ ] **Step 1: Write the file**

Write `llms.txt`:

```text
# prumo — entry point for AI agents

Prumo is a systematic-review / meta-analysis platform. Backend: Python 3.11 +
FastAPI + Celery + Postgres (Supabase). Frontend: React 18 + TypeScript + Vite.
Hosting: Railway (backend + worker + Redis) + Vercel (frontend) + Supabase
(Postgres + Auth + Storage).

## Read these first if you are an AI agent

- [README.md](README.md) — project overview, quickstart, scripts
- [CLAUDE.md](CLAUDE.md) — recent changes, active stack, current spec pointer
- [.claude/CLAUDE.md](.claude/CLAUDE.md) — project conventions for AI assistants
- [.specify/memory/constitution.md](.specify/memory/constitution.md) — non-negotiable architectural principles
- [docs/README.md](docs/README.md) — Diátaxis-organised doc index

## Then, depending on what you are touching

- Database / migrations → [docs/reference/migrations.md](docs/reference/migrations.md)
- Extraction or quality-assessment → [docs/reference/extraction-hitl-architecture.md](docs/reference/extraction-hitl-architecture.md)
- Deployment → [docs/reference/deployment.md](docs/reference/deployment.md)
- Tests → [docs/reference/test-strategy.md](docs/reference/test-strategy.md)
- An architectural decision → [docs/adr/](docs/adr/)

## Do not read these (archived / generated)

- backend/alembic/versions/archive/
- docs/superpowers/specs/archive/
- docs/superpowers/plans/archive/
- node_modules/
- playwright-report/
- test-results/

## Documentation conventions

- Every doc carries `status`, `last_reviewed`, `owner` frontmatter.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`, `refactor:`).
- English only for code, comments, commits, and documentation.
```

- [ ] **Step 2: Commit**

```bash
git add llms.txt
git commit -m "docs: add llms.txt pointer for AI agents"
```

---

## Phase 4 — Spec Surface Consolidation

> **Why:** Two parallel spec trails (legacy `specs/00X/` + modern `docs/superpowers/`) is a constant "which one is current?" question. Archiving the legacy trail under the modern surface with a clear index closes that question forever.

### Task 4.1 — Create archive shell with README

**Files:**
- Create: `docs/superpowers/specs/archive/legacy-spec-kit/README.md`

- [ ] **Step 1: Create the folder and README**

Run: `mkdir -p docs/superpowers/specs/archive/legacy-spec-kit`

Write `docs/superpowers/specs/archive/legacy-spec-kit/README.md`:

```markdown
---
status: archived
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Archived: legacy spec-kit specifications

> **Status:** Archived 2026-05-24. Frozen — do not edit.

Between 2025-Q4 and 2026-04, prumo used the
[spec-kit](https://github.com/github/spec-kit) format under `/specs/` for
feature specifications. Each feature carried `spec.md`, `plan.md`, `tasks.md`,
`data-model.md`, `research.md`, and `quickstart.md`.

From 2026-04-27 onwards, the project consolidated on the
**superpowers** specification format (single `<date>-<slug>-design.md` per
feature, with execution captured separately in `docs/superpowers/plans/`).

The legacy specs below are preserved for historical context. They reflect the
state of the project at the time they were written; **do not treat them as
current**. For the up-to-date architecture, see
[`docs/reference/extraction-hitl-architecture.md`](../../../../reference/extraction-hitl-architecture.md).

## Inventory

| # | Slug | Status | Notes |
|---|---|---|---|
| 001 | alembic-migrations | Shipped | Backend Alembic adoption |
| 002 | ai-assessment-flow | Shipped | Original AI assessment pipeline (largely superseded by HITL refactor) |
| 003 | fix-assessment-sync | Shipped | Sync bug fix |
| 004 | frontend-i18n | Shipped | In-house i18n module (`frontend/lib/copy/`) |
| 005 | articles-export | Shipped | Excel articles export |
| 006 | zotero-articles-sync | Shipped | Zotero integration |
| 007 | (placeholder) | Cancelled | See `007-cancelled-placeholder.md` |
| 008 | unified-evaluation-model | **Cancelled** | Stack dropped in the 2026-04-27 HITL unification (migration `0016_drop_008_stack`). Replaced by the extraction-centric stack with `kind=quality_assessment`. |
| 009 | extraction-excel-export | Shipped | Excel extraction export |

## Where new specs live

`docs/superpowers/specs/<date>-<slug>-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/archive/legacy-spec-kit/README.md
git commit -m "docs(superpowers): scaffold legacy spec-kit archive with inventory"
```

### Task 4.2 — Move spec 001 with frontmatter

**Files:**
- Move: `specs/001-alembic-migrations/` → `docs/superpowers/specs/archive/legacy-spec-kit/001-alembic-migrations/`
- Modify: each `.md` inside gains a status banner

- [ ] **Step 1: Move the folder**

Run:

```bash
git mv specs/001-alembic-migrations docs/superpowers/specs/archive/legacy-spec-kit/001-alembic-migrations
```

- [ ] **Step 2: Add banner to `spec.md`**

Edit `docs/superpowers/specs/archive/legacy-spec-kit/001-alembic-migrations/spec.md` — prepend:

```markdown
---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
spec_number: '001'
---

> **Status:** Shipped · Archived 2026-05-24. Do not edit. See [`docs/reference/migrations.md`](../../../../../reference/migrations.md) for the current migration strategy.

```

- [ ] **Step 3: Update inbound references**

Run: `grep -rln "specs/001" --include='*.md' . | grep -v node_modules`

Update each path → `docs/superpowers/specs/archive/legacy-spec-kit/001-alembic-migrations/...`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/archive/legacy-spec-kit/001-alembic-migrations/ specs/001-alembic-migrations
git commit -m "docs(superpowers): archive specs/001-alembic-migrations under legacy-spec-kit"
```

### Task 4.3 — Move spec 002 (same pattern as 4.2)

**Files:** `specs/002-ai-assessment-flow/` → `docs/superpowers/specs/archive/legacy-spec-kit/002-ai-assessment-flow/`

- [ ] **Step 1: Move**

```bash
git mv specs/002-ai-assessment-flow docs/superpowers/specs/archive/legacy-spec-kit/002-ai-assessment-flow
```

- [ ] **Step 2: Add the same status banner to `spec.md` (replace 001 with 002 in `spec_number`)**

```markdown
---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
spec_number: '002'
superseded_by: '2026-04-27-extraction-hitl-and-qa-design.md'
---

> **Status:** Shipped (largely superseded by the 2026-04-27 HITL refactor) · Archived 2026-05-24. Do not edit.
```

- [ ] **Step 3: Update inbound references**

Run: `grep -rln "specs/002" --include='*.md' . | grep -v node_modules`

Update each.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/archive/legacy-spec-kit/002-ai-assessment-flow/ specs/002-ai-assessment-flow
git commit -m "docs(superpowers): archive specs/002-ai-assessment-flow under legacy-spec-kit"
```

### Task 4.4 — Move specs 003, 004, 005, 006, 009 (each one its own commit)

**Files:** same pattern as 4.2/4.3 for each spec folder.

For each `N` in `{003-fix-assessment-sync, 004-frontend-i18n, 005-articles-export, 006-zotero-articles-sync, 009-extraction-excel-export}`:

- [ ] **Step 1: Move**

```bash
git mv specs/${N} docs/superpowers/specs/archive/legacy-spec-kit/${N}
```

- [ ] **Step 2: Add status banner to `spec.md` (status: shipped, spec_number, no superseded_by unless applicable)**

```markdown
---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
spec_number: '<N>'
---

> **Status:** Shipped · Archived 2026-05-24. Do not edit.
```

- [ ] **Step 3: Update inbound references for that spec number**

```bash
grep -rln "specs/${N}" --include='*.md' . | grep -v node_modules
```

Update each.

- [ ] **Step 4: One commit per spec**

```bash
git add docs/superpowers/specs/archive/legacy-spec-kit/${N}/ specs/${N}
git commit -m "docs(superpowers): archive specs/${N} under legacy-spec-kit"
```

### Task 4.5 — Move spec 008 with `cancelled` status

**Files:** `specs/008-unified-evaluation-model/` → `docs/superpowers/specs/archive/legacy-spec-kit/008-unified-evaluation-model/`

- [ ] **Step 1: Move**

```bash
git mv specs/008-unified-evaluation-model docs/superpowers/specs/archive/legacy-spec-kit/008-unified-evaluation-model
```

- [ ] **Step 2: Add the cancellation banner**

Prepend to `spec.md`:

```markdown
---
status: cancelled
last_reviewed: 2026-05-24
owner: '@raphaelfh'
spec_number: '008'
superseded_by: '2026-04-27-extraction-hitl-and-qa-design.md'
cancelled_in: 'migration 0016_drop_008_stack'
---

> **Status:** Cancelled — implementation skeleton dropped 2026-04-27 in migration `0016_drop_008_stack`. Replaced by the extraction-centric HITL stack with `kind=quality_assessment`. Do not edit.

For the current design see [`../../../../2026-04-27-extraction-hitl-and-qa-design.md`](../../../2026-04-27-extraction-hitl-and-qa-design.md).
```

- [ ] **Step 3: Update inbound references**

```bash
grep -rln "specs/008" --include='*.md' . | grep -v node_modules
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/archive/legacy-spec-kit/008-unified-evaluation-model/ specs/008-unified-evaluation-model
git commit -m "docs(superpowers): archive specs/008 as cancelled (stack dropped in 0016)"
```

### Task 4.6 — Create `007-cancelled-placeholder.md`

**Files:**
- Create: `docs/superpowers/specs/archive/legacy-spec-kit/007-cancelled-placeholder.md`

- [ ] **Step 1: Write the placeholder**

(Using the verdict captured by Task 1.4. If git history yielded the original slug, include it; otherwise mark "reserved-never-used".)

Write `docs/superpowers/specs/archive/legacy-spec-kit/007-cancelled-placeholder.md`:

```markdown
---
status: cancelled
last_reviewed: 2026-05-24
owner: '@raphaelfh'
spec_number: '007'
cancelled_in: 'never materialised'
---

> **Status:** Cancelled / never materialised · Placeholder created 2026-05-24.

The number `007` was reserved during the spec-kit era but no spec was ever
written. Recording this explicitly avoids the recurring question "what was
007 supposed to be?".

If `git log --all --diff-filter=D -- 'specs/007*'` ever surfaces a deleted
predecessor, update this file with the original slug, the deletion commit,
and a one-line reason.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/archive/legacy-spec-kit/007-cancelled-placeholder.md
git commit -m "docs(superpowers): document spec/007 as cancelled placeholder"
```

### Task 4.7 — Delete the empty top-level `specs/` directory

**Files:**
- Delete: `specs/` (if empty)

- [ ] **Step 1: Confirm empty**

Run: `ls specs/ 2>/dev/null`

Expected: nothing.

- [ ] **Step 2: Remove**

Run: `rmdir specs 2>/dev/null && git status --short | head`

Expected: no leftover.

- [ ] **Step 3: Commit (only if `git status` shows a change — likely nothing to commit since git already removed the tracked entries)**

```bash
git commit --allow-empty -m "docs(superpowers): legacy specs/ tree fully archived"
```

### Task 4.8 — Add status frontmatter to active `docs/superpowers/specs/*.md`

**Files:**
- Modify each of the 7 active specs:
  - `2026-04-27-extraction-hitl-and-qa-design.md` (status: frozen)
  - `2026-04-27-sidebar-revitalization-design.md` (status: shipped)
  - `2026-04-28-pdf-viewer-database-requirements.md` (status: shipped or in_progress — verify)
  - `2026-05-03-screening-and-imports-design.md` (status: in_progress or shipped — verify)
  - `2026-05-19-architectural-quality-autoloop-design.md` (status: stable)
  - `2026-05-22-dark-light-ux-tokenization-design.md` (status: shipped or in_progress — verify)
  - `2026-05-22-preflight-slash-command-design.md` (status: shipped or stable — verify)

- [ ] **Step 1: For each file, prepend the frontmatter**

🛑 **DECISION**: per spec, ask "is `<filename>` currently being implemented, shipped, or frozen?" and pick the matching status. The recommended default for design specs that have been executed is `frozen` if they should not be edited, `shipped` if they were the source of completed work, `in_progress` if execution is ongoing.

Frontmatter shape (adjust `status` per spec):

```markdown
---
status: <chosen>
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** <Chosen> · Last reviewed: 2026-05-24 · Owner: @raphaelfh
```

For the extraction HITL design, add an extra line:

```markdown
> **Frozen — do not edit.** For changes, write a new spec that supersedes this one.
```

- [ ] **Step 2: One commit per file**

```bash
git add docs/superpowers/specs/<file>.md
git commit -m "docs(superpowers): add status frontmatter to <file>"
```

### Task 4.9 — Add status frontmatter to active `docs/superpowers/plans/*.md`

**Files:** 12 active plan files (post-archive of `2026-05-24-render-to-railway-migration.md` in Task 1.3).

- [ ] **Step 1: Per plan**

Prepend:

```markdown
---
status: <shipped | in_progress | draft>
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** <Chosen> · Last reviewed: 2026-05-24 · Owner: @raphaelfh
```

🛑 **DECISION (per plan)**: "is this plan shipped, in progress, or draft?" — answer drives the `status` value.

- [ ] **Step 2: One commit covering the plans (frontmatter-only changes are safe to batch)**

```bash
git add docs/superpowers/plans/*.md
git commit -m "docs(superpowers): add status frontmatter to active plans"
```

---

## Phase 5 — Rewrite the Entry-Door Documents (README + backend/README)

### Task 5.1 — Rewrite the root `README.md` in English

**Files:**
- Rewrite: `README.md`

- [ ] **Step 1: Replace the entire file**

Write `README.md` (full replacement):

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Prumo

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)
![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)

A complete platform for managing systematic reviews and meta-analyses.

## Features

- **Article management** — import, organise, and manage research articles.
- **Zotero integration** — import articles directly from Zotero collections.
- **AI-assisted assessment** — automated quality scoring with OpenAI (GPT-4o) and Anthropic (Claude).
- **Batch processing** — process multiple articles and assessment items in parallel via Celery.
- **Data extraction** — build custom forms backed by versioned templates (CHARMS, custom).
- **Quality assessment (HITL)** — risk-of-bias appraisal with PROBAST, QUADAS-2, and reviewer consensus.
- **PDF viewer** — integrated reader with annotations and search.

## Tech stack

**Backend** — Python 3.11+, FastAPI, SQLAlchemy 2.0 (async), Alembic, Celery + Redis, Pydantic v2, structlog, gunicorn + uvicorn worker.
**Frontend** — TypeScript (strict), React 18.3 + Vite, TanStack Query, Zustand, Tailwind + shadcn/ui (Radix), react-hook-form, Zod, in-house i18n (`frontend/lib/copy/`).
**Database / Auth / Storage** — PostgreSQL (Supabase), Row Level Security with project-scoped helpers.
**Testing** — pytest (backend), Vitest (frontend), Playwright (E2E + a11y + visual).
**Hosting** — Vercel (frontend) + Railway (backend web + Celery worker + managed Redis) + Supabase (Postgres + Auth + Storage).

## Quickstart

### Requirements

- Node.js 24 LTS and `npm` (recommended via [`nvm`](https://github.com/nvm-sh/nvm#installing-and-updating))
- Python 3.11+ and [`uv`](https://github.com/astral-sh/uv)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker Desktop (for the local Supabase stack)
- `make` (preinstalled on macOS/Linux)

### Setup

```sh
# 1. Clone
git clone https://github.com/raphaelfh/prumo.git
cd prumo

# 2. First-time install
make setup

# 3. (Optional) configure env
cp .env.example .env  # only if make setup did not already
$EDITOR .env backend/.env

# 4. Start the full local stack (Supabase + backend + worker + frontend)
make start

# 5. Sanity checks
make status
make urls
```

| URL | Service |
|---|---|
| <http://localhost:8080> | Frontend (Vite dev server) |
| <http://localhost:8000> | Backend API |
| <http://localhost:8000/api/v1/docs> | OpenAPI / Swagger UI |
| <http://127.0.0.1:54323> | Supabase Studio |

For manual setup (without `make`), see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).

## Common commands

| Command | Purpose |
|---|---|
| `make start` / `make stop` / `make restart` | Lifecycle of the local stack |
| `make status` / `make health` / `make urls` | Status, health, URL list |
| `make test-backend` / `make lint-backend` | Backend pytest + ruff |
| `make db-fresh` | Reset + migrate + seed (idempotent) |
| `npm test` / `npm run test:run` / `npm run test:coverage` | Frontend Vitest |
| `npm run lint` / `npm run build` / `npm run dev` | Frontend ESLint / production build / dev server |
| `npx playwright test` | E2E suite (see [`frontend/e2e/README.md`](frontend/e2e/README.md)) |

## Documentation

- 📖 [Documentation index](docs/README.md) — Diátaxis-organised site map.
- 🚀 [Deployment reference](docs/reference/deployment.md) — Railway + Vercel topology, env vars, rollback.
- 🧱 [Extraction + HITL architecture](docs/reference/extraction-hitl-architecture.md) — canonical schema, run lifecycle.
- 🛢️ [Migration strategy](docs/reference/migrations.md) — Alembic vs Supabase split, squash recipe.
- ✅ [Test strategy](docs/reference/test-strategy.md) — load-bearing tests.
- 🧭 [ADRs](docs/adr/) — recorded architecture decisions.
- 🗺️ [Roadmap](docs/ROADMAP.md) — milestones + link to GitHub Projects.

### Community

- [Contributing](.github/CONTRIBUTING.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Security policy](.github/SECURITY.md)
- [Support](.github/SUPPORT.md)

## Project layout

```
prumo/
├── frontend/                # React + Vite app
│   ├── components/          # UI components (shadcn + custom)
│   ├── hooks/               # Custom React hooks
│   ├── services/            # API clients
│   ├── pages/               # Routes
│   ├── lib/                 # Utilities, i18n (copy/), validators
│   └── e2e/                 # Playwright suite
├── backend/                 # FastAPI app
│   ├── app/
│   │   ├── api/v1/          # REST endpoints
│   │   ├── core/            # Config, security, DI
│   │   ├── db/              # Engine, session
│   │   ├── models/          # SQLAlchemy models
│   │   ├── repositories/    # CRUD layer
│   │   ├── schemas/         # Pydantic v2 schemas
│   │   ├── services/        # Business logic
│   │   ├── worker/          # Celery tasks
│   │   └── seed.py          # Idempotent seed (CHARMS, PROBAST, QUADAS-2)
│   ├── alembic/versions/    # Migrations (app schema)
│   └── tests/               # pytest suite
├── supabase/migrations/     # Auth + Storage migrations only
├── docs/                    # Documentation (Diátaxis)
├── scripts/                 # Automation scripts
├── railway.toml             # Backend IaC (Railway)
├── vercel.json              # Frontend project config
└── docker-compose.yml       # Local-only Postgres helper
```

## Deployment

| Service | Platform |
|---|---|
| Frontend | Vercel — auto-deploys `main` |
| Backend `web` (FastAPI + gunicorn) | Railway, Hobby plan, US East |
| Backend `worker` (Celery) | Railway, Hobby plan, US East |
| Redis | Railway managed plugin |
| Postgres + Auth + Storage | Supabase |

See [`docs/reference/deployment.md`](docs/reference/deployment.md) for the
topology diagram, full environment-variable reference, deploy gates,
rollback procedure, and the CI coverage constraint.

## License

Prumo is released under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**.
See [`LICENSE`](LICENSE) for the full text.

## Acknowledgements

Thanks to every contributor who helped make this project better.
```

- [ ] **Step 2: Run link check + lint locally**

Run:

```bash
npx markdownlint-cli2 README.md
docker run --rm -v "$PWD:/input" lycheeverse/lychee --config /input/.github/lychee.toml /input/README.md
npx -y cspell --config .github/cspell.json README.md
bash scripts/docs/check-frontmatter.sh
```

Expected: no errors. Add genuine domain terms to `cspell-words.txt` if needed.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README in English with accurate stack, deploy, and Diátaxis links"
```

### Task 5.2 — Rewrite `backend/README.md` in English

**Files:**
- Rewrite: `backend/README.md`

- [ ] **Step 1: Replace the file**

Write `backend/README.md`:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Prumo Backend

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

FastAPI service for prumo — the systematic-review platform.

## Stack

- **FastAPI** — async web framework.
- **SQLAlchemy 2.0** (async) — ORM, typed queries.
- **Alembic** — migrations for the `public` schema.
- **Pydantic v2** — validation and serialisation.
- **Celery + Redis** — background tasks (extraction, imports, exports).
- **Gunicorn + UvicornWorker** — production server.
- **Supabase** — Postgres + Auth + Storage (source of truth).
- **OpenAI** (GPT-4o) and **Anthropic** (Claude) — LLM providers.
- **structlog** — structured logging with `trace_id`, `run_id`, `duration_ms`.

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip
- Local Supabase stack (`supabase start` from the repo root)

## Setup

```bash
# Install dependencies
uv sync

# Configure env
cp .env.example .env
$EDITOR .env

# Run the API
uv run uvicorn app.main:app --reload --port 8000
```

## Layout

```
backend/
├── app/
│   ├── api/v1/             # REST endpoints (FastAPI routers)
│   ├── core/               # Config, security, DI, factories
│   ├── db/                 # Engine, AsyncSessionLocal
│   ├── models/             # SQLAlchemy 2.0 models
│   ├── repositories/       # CRUD layer (flush, never commit)
│   ├── schemas/            # Pydantic v2 schemas
│   ├── services/           # Business logic
│   ├── worker/             # Celery app + task modules
│   └── seed.py             # Idempotent seed
├── alembic/                # Migration env
│   └── versions/           # Migrations (active) + versions/archive/
├── tests/                  # pytest (integration + unit + e2e contract)
├── Dockerfile              # Used by Railway for both web and worker
└── pyproject.toml          # Dependencies (uv)
```

## API endpoints (high level)

| Prefix | Domain |
|---|---|
| `/api/v1/projects` | Project + member management |
| `/api/v1/articles` | Article CRUD + Zotero import |
| `/api/v1/extraction` | Extraction-specific operations |
| `/api/v1/runs` | HITL run lifecycle (proposals, decisions, consensus, publish) |
| `/api/v1/hitl/sessions` | Open HITL session by kind (`extraction` or `quality_assessment`) |
| `/api/v1/extraction-export` | Excel export of extraction results |
| `/health` | Liveness probe |

Full schema is served at `/api/v1/docs` (Swagger UI) and `/api/v1/redoc`.

## Tests

```bash
# All tests
uv run pytest

# Integration only
uv run pytest tests/integration/

# With coverage
uv run pytest --cov=app --cov-report=term-missing
```

Integration tests require a local Postgres with the schema applied. The
fast path is `make db-fresh` from the repo root.

## Architecture references

- [Migration strategy](../docs/reference/migrations.md) — Alembic owns `public`, Supabase CLI owns `auth`/`storage`. Hand-write migrations, one logical change each, RLS on every new table.
- [Extraction + HITL architecture](../docs/reference/extraction-hitl-architecture.md) — schema, run lifecycle, RLS posture.
- [Deployment](../docs/reference/deployment.md) — Railway topology, env vars, gunicorn timeouts, rollback.
- [Extraction E2E observability](../docs/how-to/observability-extraction.md) — `trace_id`, `run_id`, `db_duration_ms`.
- [ADRs](../docs/adr/) — recorded architecture decisions.
- [Constitution](../.specify/memory/constitution.md) — non-negotiable architectural principles (layered architecture, DI first, split migration ownership, security by design, typed everything).

## Docker

```bash
docker build -t prumo-backend .
docker run -p 8000:8000 --env-file .env prumo-backend
```

(The image tag `prumo-backend` is local-only — Railway builds the same
Dockerfile and tags it internally.)

## License

AGPL-3.0 — see [`LICENSE`](../LICENSE).
```

- [ ] **Step 2: Lint and link-check**

```bash
npx markdownlint-cli2 backend/README.md
docker run --rm -v "$PWD:/input" lycheeverse/lychee --config /input/.github/lychee.toml /input/backend/README.md
npx -y cspell --config .github/cspell.json backend/README.md
```

- [ ] **Step 3: Commit**

```bash
git add backend/README.md
git commit -m "docs(backend): rewrite README in English with accurate Celery/Railway/HITL stack"
```

### Task 5.3 — Refresh `frontend/e2e/README.md` (status banner + minor edits)

**Files:**
- Modify: `frontend/e2e/README.md`

- [ ] **Step 1: Prepend frontmatter**

Edit the top of the file to add:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

```

- [ ] **Step 2: Lint**

```bash
npx markdownlint-cli2 frontend/e2e/README.md
```

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/README.md
git commit -m "docs(e2e): add status frontmatter to E2E README"
```

### Task 5.4 — Refresh `frontend/pdf-viewer/README.md` and `scripts/fitness/README.md`

**Files:**
- Modify: `frontend/pdf-viewer/README.md`
- Modify: `scripts/fitness/README.md`

- [ ] **Step 1: Read both files first**

Run: `cat frontend/pdf-viewer/README.md scripts/fitness/README.md`

- [ ] **Step 2: Add the same frontmatter pattern to each**

Use `stable` for `frontend/pdf-viewer/README.md` if the PDF viewer ships; `stable` for `scripts/fitness/README.md` if the fitness scripts are in use. Adjust if either is a stub.

- [ ] **Step 3: Lint + commit (one commit per file)**

```bash
npx markdownlint-cli2 frontend/pdf-viewer/README.md && \
  git add frontend/pdf-viewer/README.md && \
  git commit -m "docs(pdf-viewer): add status frontmatter"

npx markdownlint-cli2 scripts/fitness/README.md && \
  git add scripts/fitness/README.md && \
  git commit -m "docs(scripts/fitness): add status frontmatter"
```

---

## Phase 6 — Architecture References (Translate, Move, Stamp)

> **Sequencing:** move first (preserves history), then patch render.yaml refs and add frontmatter inside the new location, then update inbound references everywhere. One file per task.

### Task 6.1 — Move `docs/architecture/deployment.md` → `docs/reference/deployment.md`

**Files:**
- Move: `docs/architecture/deployment.md` → `docs/reference/deployment.md`

- [ ] **Step 1: Move**

```bash
git mv docs/architecture/deployment.md docs/reference/deployment.md
```

- [ ] **Step 2: Prepend frontmatter (existing file already has "Last updated: 2026-05-24" — keep that, add YAML on top)**

Insert at the very top:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

```

- [ ] **Step 3: Update inbound references**

Run: `grep -rln "docs/architecture/deployment.md" --include='*.md' . | grep -v node_modules`

Update each with the new path (`docs/reference/deployment.md`). Files likely to touch: `README.md` (already rewritten in 5.1 with new path), `CLAUDE.md`, `.claude/CLAUDE.md`, `backend/README.md`, `docs/README.md`, `docs/superpowers/plans/archive/2026-05-24-render-to-railway/plan.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/deployment.md docs/architecture/deployment.md $(grep -rl "docs/architecture/deployment.md" --include='*.md' .)
git commit -m "docs(reference): move deployment.md from architecture/ to reference/ (Diátaxis)"
```

### Task 6.2 — Move + patch `extraction-hitl-architecture.md`

**Files:**
- Move: `docs/architecture/extraction-hitl-architecture.md` → `docs/reference/extraction-hitl-architecture.md`
- Modify: drop the `render.yaml` mention in §timeouts

- [ ] **Step 1: Move**

```bash
git mv docs/architecture/extraction-hitl-architecture.md docs/reference/extraction-hitl-architecture.md
```

- [ ] **Step 2: Prepend frontmatter (replace the existing "post 2026-04-27" preamble cleanly)**

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh
> Canonical reference for the data-extraction and quality-assessment stack post the 2026-04-27 unification. Read this before touching anything in `extraction_*`, `extraction_runs`, the workflow tables, or the Quality-Assessment flow.

```

- [ ] **Step 3: Patch the `render.yaml` reference (line ~211)**

Open the file, find: `this repo uses **120s** in `render.yaml`` and replace with: `the production Dockerfile uses **120s** (`-t 120`)`.

- [ ] **Step 4: Update inbound references**

Run: `grep -rln "docs/architecture/extraction-hitl-architecture.md" --include='*.md' . | grep -v node_modules`

Update each.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/extraction-hitl-architecture.md docs/architecture/extraction-hitl-architecture.md $(grep -rl "docs/architecture/extraction-hitl-architecture.md" --include='*.md' .)
git commit -m "docs(reference): move extraction-hitl-architecture and drop render.yaml reference"
```

### Task 6.3 — Move + stamp `docs/architecture/migrations.md`

**Files:**
- Move: `docs/architecture/migrations.md` → `docs/reference/migrations.md`

- [ ] **Step 1: Move + frontmatter**

```bash
git mv docs/architecture/migrations.md docs/reference/migrations.md
```

Prepend:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

```

- [ ] **Step 2: Update inbound references**

```bash
grep -rln "docs/architecture/migrations.md" --include='*.md' . | grep -v node_modules
```

Update each.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/migrations.md docs/architecture/migrations.md $(grep -rl "docs/architecture/migrations.md" --include='*.md' .)
git commit -m "docs(reference): move migrations.md from architecture/ to reference/"
```

### Task 6.4 — Move + stamp `docs/architecture/test-strategy.md`

**Files:**
- Move: `docs/architecture/test-strategy.md` → `docs/reference/test-strategy.md`

- [ ] **Step 1: Move + frontmatter (status: stable)**

```bash
git mv docs/architecture/test-strategy.md docs/reference/test-strategy.md
```

Prepend the same frontmatter block.

- [ ] **Step 2: Update inbound references**

```bash
grep -rln "docs/architecture/test-strategy.md" --include='*.md' . | grep -v node_modules
```

Update each.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/test-strategy.md docs/architecture/test-strategy.md $(grep -rl "docs/architecture/test-strategy.md" --include='*.md' .)
git commit -m "docs(reference): move test-strategy.md from architecture/ to reference/"
```

### Task 6.5 — Delete the empty `docs/architecture/` folder

**Files:**
- Delete: `docs/architecture/`

- [ ] **Step 1: Confirm empty**

```bash
ls docs/architecture/ 2>/dev/null
```

- [ ] **Step 2: Remove**

```bash
rmdir docs/architecture
```

- [ ] **Step 3: Commit (empty if necessary)**

```bash
git commit --allow-empty -m "docs: remove now-empty docs/architecture/ (Diátaxis migration complete)"
```

### Task 6.6 — Translate + move `docs/DATABASE_SEEDING.md` → `docs/how-to/seed-database.md`

**Files:**
- Move + rewrite: `docs/DATABASE_SEEDING.md` → `docs/how-to/seed-database.md`

- [ ] **Step 1: Move**

```bash
git mv docs/DATABASE_SEEDING.md docs/how-to/seed-database.md
```

- [ ] **Step 2: Rewrite the file in English, dropping `render.yaml` references**

Write `docs/how-to/seed-database.md` (full replacement):

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Seed the database

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

This guide explains how to load seed data after the schema migrations run.

## What gets seeded

- **CHARMS v1.1** — global extraction template (`kind=extraction`) for
  prediction-model data. ~14 entity types, ~80 fields. Helper:
  `seed_charms()` in [`backend/app/seed.py`](../../backend/app/seed.py).
  Split into study-level fields (entered once per article) and per-model
  fields (entered once per evaluated model) since 2026-05-17.
- **PROBAST** — global quality-assessment template
  (`kind=quality_assessment`). 5 domains (Participants, Predictors, Outcome,
  Analysis, Overall) + 22 signaling + summary fields. Deterministic UUID.
  Helper: `seed_probast()`.
- **QUADAS-2** — global quality-assessment template for diagnostic-accuracy
  studies. 5 domains + Overall, 11 signaling questions + summary fields with
  `allowed_values=['Y','N','Unclear']`. Deterministic UUID. Helper:
  `seed_quadas2()`.

> Quality-assessment templates are seeded as `kind=quality_assessment` in
> `extraction_templates_global`. When the frontend opens an assessment via
> `POST /api/v1/hitl/sessions` with `kind=quality_assessment`, the backend
> clones the template into `project_extraction_templates` (idempotent).
> See [`docs/reference/extraction-hitl-architecture.md`](../reference/extraction-hitl-architecture.md)
> for the full flow.

## Local development

### Automatic (recommended)

```bash
make reset-db    # Reset + seed in one shot
```

### Manual

```bash
make seed                                                       # via the Makefile
# or
cd backend && uv run python -m app.seed                         # directly
```

## Production (Supabase)

### Option 1 — Wire into the Railway boot

The Railway `web` service runs `alembic upgrade head && gunicorn ...` from
`backend/Dockerfile` on every deploy. To also run the seed on boot, change
the Dockerfile `CMD` to:

```dockerfile
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]
```

Because `seed.py` is idempotent, running it on every boot is safe. Do **not**
add the seed to the `worker` service — it has no need for it and does not
run Alembic.

### Option 2 — One-off manual run

```bash
# Use the Supabase connection string (Settings → Database → Connection String → URI)
export DATABASE_URL="postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres"

cd backend && uv run python -m app.seed

# Verify
psql "$DATABASE_URL" -c "SELECT name, version, kind FROM extraction_templates_global ORDER BY kind, name;"
```

## Re-seeding

The script is **idempotent**. If a template already exists it is left alone;
otherwise it is created.

## Verification queries

```sql
-- CHARMS
SELECT name,
       framework,
       version,
       (SELECT COUNT(*) FROM extraction_entity_types
        WHERE template_id = extraction_templates_global.id)  AS entity_types,
       (SELECT COUNT(*) FROM extraction_fields ef
        JOIN extraction_entity_types et ON ef.entity_type_id = et.id
        WHERE et.template_id = extraction_templates_global.id) AS fields
FROM extraction_templates_global
WHERE framework = 'CHARMS';

-- PROBAST + QUADAS-2
SELECT name, kind, version
FROM extraction_templates_global
WHERE kind = 'quality_assessment'
ORDER BY name;
```

Expected:

| Template | Version | Entity types | Fields |
|---|---|---|---|
| CHARMS | 1.1.0 | 14 | ~80 |
| PROBAST | 1.0.0 | 5 | 22+ |
| QUADAS-2 | 1.0.0 | 5 | 11+ |

## Troubleshooting

### `column ... does not exist`

Supabase migrations ran but Alembic did not. Fix:

```bash
cd backend && uv run alembic upgrade head && make seed
```

### `DATABASE_URL pointing to wrong database`

A shell-level `DATABASE_URL` is overriding `.env`. Either `unset DATABASE_URL`
or override explicitly:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" make seed
```

### "Seed appears to do nothing"

Idempotency. Verify rows exist:

```bash
psql "$DATABASE_URL" -c "SELECT name FROM extraction_templates_global;"
```

## References

- Seed script: [`backend/app/seed.py`](../../backend/app/seed.py)
- Makefile target: `seed` (search the Makefile for `seed:`)
- PROBAST source: <https://www.probast.org/>
- CHARMS source: <https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0>
- TRIPOD+AI: <https://www.tripod-statement.org/>
```

- [ ] **Step 3: Update inbound references**

```bash
grep -rln "DATABASE_SEEDING" --include='*.md' . | grep -v node_modules
```

Update each.

- [ ] **Step 4: Lint + commit**

```bash
npx markdownlint-cli2 docs/how-to/seed-database.md
git add docs/how-to/seed-database.md docs/DATABASE_SEEDING.md $(grep -rl "DATABASE_SEEDING" --include='*.md' .)
git commit -m "docs(how-to): translate seed-database guide to English, drop render.yaml ref, fix CHARMS to v1.1"
```

### Task 6.7 — Move `docs/extraction-e2e-observability.md` → `docs/how-to/observability-extraction.md`

**Files:**
- Move: `docs/extraction-e2e-observability.md` → `docs/how-to/observability-extraction.md`

- [ ] **Step 1: Move**

```bash
git mv docs/extraction-e2e-observability.md docs/how-to/observability-extraction.md
```

- [ ] **Step 2: Add frontmatter + status banner**

Prepend:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

```

- [ ] **Step 3: Update inbound references**

```bash
grep -rln "extraction-e2e-observability" --include='*.md' . | grep -v node_modules
```

- [ ] **Step 4: Commit**

```bash
git add docs/how-to/observability-extraction.md docs/extraction-e2e-observability.md $(grep -rl "extraction-e2e-observability" --include='*.md' .)
git commit -m "docs(how-to): move extraction-e2e-observability to Diátaxis how-to/"
```

### Task 6.8 — Add frozen banner to the canonical HITL design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md`

- [ ] **Step 1: Prepend frontmatter + frozen banner**

```markdown
---
status: frozen
last_reviewed: 2026-05-24
owner: '@raphaelfh'
shipped_on: '2026-04-27'
---

> **Status:** Frozen — do not edit. Shipped 2026-04-27.
> For the current state of the extraction + HITL stack, see
> [`docs/reference/extraction-hitl-architecture.md`](../../reference/extraction-hitl-architecture.md).

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md
git commit -m "docs(superpowers): freeze 2026-04-27 HITL design spec"
```

---

## Phase 7 — Templates, ux_template, Estrutura Database

### Task 7.1 — Verify CHARMS version against the live database (gate)

**Files:**
- (Read-only verification; result drives 7.2/7.3)

- [ ] **Step 1: Run the version query**

```bash
psql "$DATABASE_URL" -c "SELECT name, version FROM extraction_templates_global WHERE framework='CHARMS';"
```

🛑 **DECISION**: If the DB version is not `1.1.0`, pause and ask the user which is the source of truth (CLAUDE.md says `1.1.0` since 2026-05-17). Adjust the doc rewrite below accordingly.

- [ ] **Step 2: Capture the verdict in the next commit message**

### Task 7.2 — Move + rewrite `CHARMS_2.0_COMPLETE_TEMPLATE.md`

**Files:**
- Move: `docs/templates/CHARMS_2.0_COMPLETE_TEMPLATE.md` → `docs/reference/templates/charms-v1.1-complete.md`

- [ ] **Step 1: Read existing content (it is in English already — verify)**

```bash
cat docs/templates/CHARMS_2.0_COMPLETE_TEMPLATE.md | head -80
```

- [ ] **Step 2: Move + rename**

```bash
mkdir -p docs/reference/templates
git mv docs/templates/CHARMS_2.0_COMPLETE_TEMPLATE.md docs/reference/templates/charms-v1.1-complete.md
```

- [ ] **Step 3: Replace title and version references**

Edit the file:

- Replace `# CHARMS 2.0 …` → `# CHARMS v1.1 — Complete Template`.
- Replace any `2.0.0` literals with `1.1.0`.
- Prepend frontmatter:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
template_version: '1.1.0'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh
> Reflects the CHARMS template state after the 2026-05-17 study-level / per-model split (template version 1.1.0).

```

- [ ] **Step 4: Update inbound references**

```bash
grep -rln "CHARMS_2.0" --include='*.md' . | grep -v node_modules
```

Update each.

- [ ] **Step 5: Lint + commit**

```bash
npx markdownlint-cli2 docs/reference/templates/charms-v1.1-complete.md
git add docs/reference/templates/ docs/templates/CHARMS_2.0_COMPLETE_TEMPLATE.md $(grep -rl "CHARMS_2.0" --include='*.md' .)
git commit -m "docs(reference): move CHARMS template doc to reference/, correct version to v1.1"
```

### Task 7.3 — Translate + move `CHARMS_2.0_HIERARQUIA_VISUAL.md`

**Files:**
- Move: `docs/templates/CHARMS_2.0_HIERARQUIA_VISUAL.md` → `docs/reference/templates/charms-v1.1-hierarchy.md`

- [ ] **Step 1: Move**

```bash
git mv docs/templates/CHARMS_2.0_HIERARQUIA_VISUAL.md docs/reference/templates/charms-v1.1-hierarchy.md
```

- [ ] **Step 2: Rewrite entirely in English with v1.1 study-level split**

Write `docs/reference/templates/charms-v1.1-hierarchy.md` (full replacement). The previous file in Portuguese described `PREDICTION MODELS` as the root with all entities under it; the v1.1 split moves Source of Data, Participants, Outcome, Candidate Predictors, Sample Size, Missing Data, and Observations to the root.

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
template_version: '1.1.0'
---

# CHARMS v1.1 — visual hierarchy

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh
> **Template ID:** `438e0126-ce20-4786-80e4-1700706b045c`
> **Version:** 1.1.0 — applied in the database since 2026-05-17.

Reference: <https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0>

## Why the v1.1 split

CHARMS distinguishes **study-level** information (one record per article)
from **per-model** information (one record per evaluated prediction model).
Migration `0015_charms_studylevel_split` reparents study-level entities to
the root of the template; per-model entities stay nested under
`prediction_models`.

## Hierarchy

```
CHARMS v1.1 (root)
│
├── Source of Data            (one)   [study-level]
│   └── data_source (1.1)
│
├── Participants              (one)   [study-level]
│   ├── recruitment_method (2.1)
│   ├── recruitment_dates (2.2)
│   ├── study_setting (2.3)
│   ├── study_sites_regions (2.4)
│   ├── study_sites_number (2.5)
│   ├── inclusion_criteria (2.6)
│   ├── exclusion_criteria (2.7)
│   ├── age_of_participants (2.8.1)
│   ├── native_valve_endocarditis (2.8.2)
│   ├── valve_affected (2.8.3)
│   ├── characteristic_4 (2.8.4)
│   └── characteristic_5 (2.8.5)
│
├── Outcome                   (one)   [study-level]
│   └── …
│
├── Candidate Predictors      (one)   [study-level]
│   └── …
│
├── Sample Size               (one)   [study-level]
│   └── …
│
├── Missing Data              (one)   [study-level]
│   └── …
│
├── Observations              (one)   [study-level]
│   └── …
│
└── 🎯 Prediction Models      (many)  [model-container]   ⭐ ASSESSMENT TARGET
    ├── model_name (0.5)
    ├── modelling_method (7.1)
    │
    ├── Model Development     (one)   [per model]
    ├── Final Predictors      (one)   [per model]
    ├── Performance           (one)   [per model]
    ├── Validation            (one)   [per model]
    ├── Results               (one)   [per model]
    └── Interpretation        (one)   [per model]
```

## Field-by-field reference

See [`charms-v1.1-complete.md`](./charms-v1.1-complete.md) for the full
field inventory with types, allowed values, and CHARMS-numbered IDs.

## Related

- [Extraction + HITL architecture §4.1](../extraction-hitl-architecture.md)
- Migration `0015_charms_studylevel_split` (under `backend/alembic/versions/`)
```

- [ ] **Step 3: Update inbound references**

```bash
grep -rln "HIERARQUIA_VISUAL" --include='*.md' . | grep -v node_modules
```

- [ ] **Step 4: Lint + commit**

```bash
npx markdownlint-cli2 docs/reference/templates/charms-v1.1-hierarchy.md
git add docs/reference/templates/charms-v1.1-hierarchy.md docs/templates/CHARMS_2.0_HIERARQUIA_VISUAL.md $(grep -rl "HIERARQUIA_VISUAL" --include='*.md' .)
git commit -m "docs(reference): translate CHARMS hierarchy to English, correct to v1.1 with study-level split"
```

### Task 7.4 — Delete the now-empty `docs/templates/` folder

**Files:**
- Delete: `docs/templates/`

- [ ] **Step 1: Confirm empty**

```bash
ls docs/templates/ 2>/dev/null
```

- [ ] **Step 2: Remove + commit**

```bash
rmdir docs/templates && git commit --allow-empty -m "docs: remove now-empty docs/templates/ (CHARMS docs moved to reference/templates/)"
```

### Task 7.5 — Delete `docs/estrutura_database/` (stubs → already point to reference)

**Files:**
- Delete: `docs/estrutura_database/DATABASE_SCHEMA.md`
- Delete: `docs/estrutura_database/ESTRUTURA_PROJETO_MACRO.md`
- Delete: folder

- [ ] **Step 1: Confirm both files are stubs**

```bash
wc -l docs/estrutura_database/*.md
```

Expected: both under 20 lines (they are pointers to `docs/reference/extraction-hitl-architecture.md`).

- [ ] **Step 2: Update any remaining inbound references**

```bash
grep -rln "estrutura_database" --include='*.md' . | grep -v node_modules
```

Update each to point at `docs/reference/extraction-hitl-architecture.md` (or `docs/README.md` for "where is the macro structure?").

- [ ] **Step 3: Delete + commit**

```bash
git rm -r docs/estrutura_database/
git add $(grep -rl "estrutura_database" --include='*.md' .)
git commit -m "docs: drop docs/estrutura_database/ stubs (replaced by docs/reference/)"
```

### Task 7.6 — Rename `docs/ux_template/` → `docs/design-references/` with README

**Files:**
- Move: `docs/ux_template/linear_project_configuration.png` → `docs/design-references/linear_project_configuration.png`
- Move: `docs/ux_template/linear_ux.png` → `docs/design-references/linear_ux.png`
- Create: `docs/design-references/README.md`

- [ ] **Step 1: Move the PNGs**

```bash
mkdir -p docs/design-references
git mv docs/ux_template/linear_project_configuration.png docs/design-references/linear_project_configuration.png
git mv docs/ux_template/linear_ux.png docs/design-references/linear_ux.png
rmdir docs/ux_template
```

- [ ] **Step 2: Write the README**

Write `docs/design-references/README.md`:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Design references

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

External visual references used to anchor prumo's design vocabulary. The
current target aesthetic is the **Linear / Plane / WorkOS** family — high
density, low chrome, ratio-driven type, ASCII-style information hierarchy.

## Files

| File | What it shows | Use for |
|---|---|---|
| `linear_ux.png` | Linear's primary application UX | Inspiration for issue list density, hover affordances, command palette |
| `linear_project_configuration.png` | Linear's project configuration surface | Inspiration for the prumo project / template configuration screens |

## How to use these

These are **references, not specifications**. Treat them as a vocabulary
for design discussions — "we want this kind of density / contrast /
spacing" — and pair them with the prumo design system docs under
[`docs/superpowers/design-system/`](../superpowers/design-system/).

For component-level rules, see the `frontend-ux` and `ui-styling` skills
under `.claude/skills/`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/design-references/ docs/ux_template
git commit -m "docs: rename ux_template/ to design-references/ with proper README"
```

---

## Phase 8 — Roadmap Migration

### Task 8.1 — 🛑 DECISION: Capture the active roadmap items

**Files:**
- (Discovery — output drives Task 8.2 and a future GitHub Projects setup)

- [ ] **Step 1: List the open items from the current ROADMAP**

Open `docs/planos/ROADMAP.md` and extract every unchecked item with its
prioridade tag. Group by category. Drop completed items (✅) and the
orphaned "Fazer uma secão de escrita de artigo" stub.

- [ ] **Step 2: Translate each item to English and tag with priority**

🛑 **DECISION**: ask the user "I have N open roadmap items. Please confirm the GitHub Project URL where I should record them (or ask me to create one)." Wait for the URL. If the user wants the items as GitHub Issues instead, use that path; otherwise create a Project view.

- [ ] **Step 3: Capture the URL for use in Task 8.2**

### Task 8.2 — Write `docs/ROADMAP.md` (thin pointer)

**Files:**
- Create: `docs/ROADMAP.md`
- Delete: `docs/planos/ROADMAP.md`
- Delete: `docs/planos/`

- [ ] **Step 1: Write the new file**

Write `docs/ROADMAP.md` (substituting `<PROJECT-URL>` with the URL captured in Task 8.1):

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# Roadmap

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

The day-to-day roadmap with status, priority, owner, and target dates lives
on the GitHub Project:

**<PROJECT-URL>**

This file records only the **top-level milestones** (one bullet each) — the
"what are we aiming at this cycle?" view, not the issue tracker.

## Current cycle (2026-Q2)

- [ ] **Quality of extracted data** — refine extraction prompts, add evidence-linked citations, surface page-anchored references in the PDF viewer.
- [ ] **Multi-reviewer reliability** — close the open bugs around inviting reviewers, concurrent assessment, and final-reviewer assignment.
- [ ] **Provider flexibility (BYOK)** — design + ship the Bring-Your-Own-Key flow with audit + per-user rate limits.

## Recently shipped (2026-Q2)

- ✅ Extraction-centric HITL unification (2026-04-27).
- ✅ Role column promotion + template clone topological sort (2026-05-18 → 2026-05-19).
- ✅ Render → Railway migration (2026-05-24).

## Archived

For the previous PT/EN mixed roadmap, see git history of
`docs/planos/ROADMAP.md` prior to 2026-05-24.
```

- [ ] **Step 2: Delete the old roadmap and its folder**

```bash
git rm docs/planos/ROADMAP.md
rmdir docs/planos
```

- [ ] **Step 3: Update inbound references**

```bash
grep -rln "docs/planos" --include='*.md' . | grep -v node_modules
```

Update each to point at `docs/ROADMAP.md`.

- [ ] **Step 4: Lint + commit**

```bash
npx markdownlint-cli2 docs/ROADMAP.md
git add docs/ROADMAP.md docs/planos $(grep -rl "docs/planos" --include='*.md' .)
git commit -m "docs: migrate ROADMAP to thin pointer + GitHub Project; drop docs/planos/"
```

---

## Phase 9 — ADR Bootstrap (MADR 4.0)

### Task 9.1 — Create the MADR template

**Files:**
- Create: `docs/adr/0000-template.md`

- [ ] **Step 1: Write the template**

Write `docs/adr/0000-template.md`:

```markdown
---
status: template
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

# {ADR title — short noun phrase, no verbs}

> **Status:** Proposed · Date: YYYY-MM-DD · Deciders: @handle1, @handle2
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

What is the issue we are seeing that motivates this decision or change?
Two or three paragraphs.

## Decision Drivers

- driver 1 (e.g. operational cost)
- driver 2 (e.g. team familiarity)

## Considered Options

- Option A
- Option B
- Option C

## Decision Outcome

Chosen option: **{Option name}** because {short reason}.

### Consequences

- Good — {benefit}.
- Bad — {downside / trade-off}.
- Neutral — {side-effect that is neither good nor bad}.

## Validation

How will we validate the decision delivered the expected outcome?

## Pros and Cons of the Options

### Option A

- Good — …
- Bad — …

### Option B

- Good — …
- Bad — …

## More Information

Links, prior art, references.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0000-template.md
git commit -m "docs(adr): add MADR 4.0 template"
```

### Task 9.2 — `0001-use-madr.md` (meta-ADR)

**Files:**
- Create: `docs/adr/0001-use-madr.md`

- [ ] **Step 1: Write the ADR**

Write `docs/adr/0001-use-madr.md`:

```markdown
---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0001'
---

# Use MADR 4.0 for Architecture Decision Records

> **Status:** Accepted · Date: 2026-05-24 · Deciders: @raphaelfh

## Context and Problem Statement

The project has accumulated significant architectural decisions
(Alembic-vs-Supabase migration split, HITL `kind` discriminator,
Render→Railway hosting, AGPL-3.0 licensing, quality autoloop). Today these
are scattered across `CLAUDE.md`, plan files, and commit messages. Future
contributors (human or AI) cannot easily answer "why was X done this way?"
without trawling the entire history.

## Decision

Adopt **MADR 4.0** (<https://adr.github.io/madr/>) as the canonical format.

- Location: `docs/adr/NNNN-kebab-title.md` with monotonically-increasing
  zero-padded numbers.
- Template: `docs/adr/0000-template.md`.
- Status lifecycle: `proposed` → `accepted` → `deprecated` / `superseded by NNNN`.

## Consequences

- Good — Every important decision has one stable, citable location.
- Good — New contributors discover rationale without trawling history.
- Good — Supersession links keep the historical record intact.
- Neutral — Adds one more file to write per decision; mitigated by the template.

## Validation

By 2026-Q3, every architectural decision discussed in `CLAUDE.md` "Recent
Changes" must have a corresponding ADR. The frontmatter check enforces
ADRs carry the required keys.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0001-use-madr.md
git commit -m "docs(adr): 0001 — adopt MADR 4.0"
```

### Task 9.3 — `0002-split-alembic-supabase-ownership.md`

**Files:**
- Create: `docs/adr/0002-split-alembic-supabase-ownership.md`

- [ ] **Step 1: Write the ADR**

Write `docs/adr/0002-split-alembic-supabase-ownership.md`:

```markdown
---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0002'
---

# Split migration ownership between Alembic (public) and Supabase CLI (auth, storage)

> **Status:** Accepted · Date: 2026-04-01 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

Prumo runs on top of Supabase, which provides Postgres plus managed `auth`
and `storage` schemas with built-in triggers and policies. The application
also needs its own schema (`public.*` tables for projects, articles,
extraction templates, runs, decisions, etc.).

Mixing both in one migration system (e.g. Alembic-only or Supabase-CLI-only)
either drops Supabase-managed objects (Alembic) or makes
SQLAlchemy-autogenerate unusable (Supabase CLI).

## Decision

- **Alembic owns `public.*`** — application tables, indexes, triggers,
  enums, RLS policies. Migration files live under
  `backend/alembic/versions/`.
- **Supabase CLI owns `auth.*` and `storage.*`** — bucket creation, RLS
  on Supabase-managed schemas, the `handle_new_user` trigger that creates
  `profiles` rows. Migration files live under `supabase/migrations/`.
- The Alembic `env.py` `include_object` filter excludes everything outside
  `public.*` to prevent autogenerate noise.
- A CI script (`scripts/validate_migration_boundaries.sh`) enforces the
  split mechanically.

## Consequences

- Good — Each migration system stays in its lane; no ownership ambiguity.
- Good — Autogenerate is usable on `public.*` without producing noise from
  Supabase internals.
- Good — The app refuses to start if `alembic current ≠ alembic head`.
- Neutral — Two systems to learn; mitigated by the strict binary rule.
- Bad — One-time onboarding cost for new contributors.

## Validation

- `scripts/validate_migration_boundaries.sh` runs in CI.
- The `0001_baseline_v1` squash in 2026-04-28 confirmed the split survives
  a baseline regeneration cleanly.

## More Information

- [Migration strategy](../reference/migrations.md)
- [Constitution §III. Split Migration Ownership](../../.specify/memory/constitution.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0002-split-alembic-supabase-ownership.md
git commit -m "docs(adr): 0002 — record split migration ownership"
```

### Task 9.4 — `0003-kind-discriminator-for-hitl.md`

**Files:**
- Create: `docs/adr/0003-kind-discriminator-for-hitl.md`

- [ ] **Step 1: Write the ADR**

Write `docs/adr/0003-kind-discriminator-for-hitl.md`:

```markdown
---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0003'
supersedes: '008-unified-evaluation-model'
---

# Use a `kind` discriminator (extraction | quality_assessment) on HITL templates and runs

> **Status:** Accepted · Date: 2026-04-27 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

Pre-2026-04, prumo had two parallel HITL stacks:

1. `extraction_*` — structured data extraction (CHARMS, AI suggestions,
   reviewer/consensus).
2. The 008 "unified evaluation model" skeleton — quality assessment
   (PROBAST, QUADAS-2) with its own `evaluation_*` / `proposal_records` /
   `consensus_*` / `published_states` / `evidence_records` tables.

They duplicated workflow concepts (proposals, decisions, consensus,
published state) under different schemas, making it impossible to share
UI, services, or audit infrastructure.

## Decision

Merge both into a single extraction-centric stack discriminated by `kind`
(`template_kind` enum: `extraction`, `quality_assessment`):

- A PROBAST domain is an `entity_type` with `kind=quality_assessment`.
- A signaling question is an `extraction_field`.
- The proposal → decision → consensus → published-state pipeline is
  shared.
- Sessions open through a single endpoint
  `POST /api/v1/hitl/sessions` parameterised by `kind`.

Implemented across migrations `0010` → `0018` (2026-04-27 → 2026-04-28).

## Consequences

- Good — One UI, one service layer, one set of audit invariants.
- Good — Adding a new HITL kind in the future is a `kind` enum value, not
  a parallel stack.
- Good — All 612 LOC of the 008 skeleton dropped (migration `0016`).
- Neutral — Quality-assessment domain language ("domain", "signaling
  question") is now expressed in extraction vocabulary; the mapping is
  documented in `docs/reference/extraction-hitl-architecture.md`.
- Bad — Migration trail required a synthetic-run backfill for legacy
  `extracted_values` rows; carefully documented in the original plan.

## Validation

- Migration `0016_drop_008_stack` deleted 612 LOC of skeleton code.
- 488 integration tests pass post-unification (see
  `docs/reference/test-strategy.md`).
- PROBAST + QUADAS-2 seeded and exercised end-to-end via
  `QualityAssessmentFullScreen`.

## More Information

- [Extraction + HITL architecture](../reference/extraction-hitl-architecture.md)
- [Original design spec (frozen)](../superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md)
- [Cancelled spec/008 placeholder](../superpowers/specs/archive/legacy-spec-kit/008-unified-evaluation-model/spec.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0003-kind-discriminator-for-hitl.md
git commit -m "docs(adr): 0003 — record HITL kind discriminator unification"
```

### Task 9.5 — `0004-hosting-render-to-railway.md`

**Files:**
- Create: `docs/adr/0004-hosting-render-to-railway.md`

- [ ] **Step 1: Write the ADR**

Write `docs/adr/0004-hosting-render-to-railway.md`:

```markdown
---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0004'
---

# Host backend (web + worker + Redis) on Railway instead of Render

> **Status:** Accepted · Date: 2026-05-24 · Deciders: @raphaelfh

## Context and Problem Statement

Until 2026-05-24, the backend ran on Render's free tier. The free tier
does not provide managed Redis, which blocked the async endpoints
(`articles_export`, `zotero_import`, `extraction_export`) from working in
production — they all need a Celery broker.

## Decision

Migrate to Railway Hobby plan, US East region, with three services in one
project: `web` (FastAPI + gunicorn), `worker` (Celery), and a managed
Redis plugin.

- Both `web` and `worker` build from `backend/Dockerfile`.
- IaC committed as `railway.toml`.
- Deploys are GitHub-App driven from `main`, gated by **Wait for CI**.
- Fallback when CI is red: `railway up backend --path-as-root --service <name>`.

## Consequences

- Good — Async endpoints work in production for the first time.
- Good — Hobby plan still affordable at this scale.
- Good — Three services share the same private network for Redis access
  (no public traffic to broker).
- Neutral — Manual env-var management (no `.env.railway.example` is tracked).
- Bad — Currently the CI coverage gate (62%) sometimes SKIPs the Railway
  deploy when the threshold drops; documented workaround in
  `docs/reference/deployment.md`.

## Validation

- Production URL: <https://web-production-48b398.up.railway.app>
- `/health` returns 200.
- Celery worker registers all task names (drift guard at
  `backend/tests/unit/test_celery_app_task_registry.py`).

## More Information

- [Deployment reference](../reference/deployment.md)
- [Archived plan](../superpowers/plans/archive/2026-05-24-render-to-railway/plan.md)
- [`railway.toml`](../../railway.toml)
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0004-hosting-render-to-railway.md
git commit -m "docs(adr): 0004 — record Render → Railway hosting decision"
```

### Task 9.6 — `0005-license-agpl-3.0.md`

**Files:**
- Create: `docs/adr/0005-license-agpl-3.0.md`

- [ ] **Step 1: Write the ADR**

Write `docs/adr/0005-license-agpl-3.0.md`:

```markdown
---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0005'
---

# Release prumo under the GNU AGPL-3.0-only

> **Status:** Accepted · Date: 2025-Q4 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

Prumo is a research-platform SaaS. Without a copyleft licence, a hosted
fork could differentiate from the canonical project without contributing
back, weakening the upstream community.

## Decision

Release under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)**.

Anyone running a modified version of prumo as a network service must
release their modifications under the same licence.

## Consequences

- Good — Hosted forks cannot strip community-facing improvements.
- Good — Aligns with comparable scientific-software projects.
- Neutral — Some commercial integrators will need to negotiate a separate
  licence; offer that explicitly if it becomes relevant.
- Bad — Slightly higher friction for adoption by closed-source SaaS
  vendors; intentional.

## Validation

- `LICENSE` file at the repo root contains the full AGPL-3.0 text.
- README badge and footer cite the licence.
- All source headers fall under the licence by virtue of the repo-level
  `LICENSE`; no per-file headers needed (industry norm).

## More Information

- License text: [`LICENSE`](../../LICENSE)
- AGPL FAQ: <https://www.gnu.org/licenses/agpl-3.0.html>
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0005-license-agpl-3.0.md
git commit -m "docs(adr): 0005 — record AGPL-3.0-only licensing decision"
```

### Task 9.7 — `0006-quality-autoloop-as-development-practice.md`

**Files:**
- Create: `docs/adr/0006-quality-autoloop-as-development-practice.md`

- [ ] **Step 1: Write the ADR**

Write `docs/adr/0006-quality-autoloop-as-development-practice.md`:

```markdown
---
status: accepted
last_reviewed: 2026-05-24
owner: '@raphaelfh'
adr_number: '0006'
---

# Adopt the architectural quality autoloop as a first-class development practice

> **Status:** Accepted · Date: 2026-05-19 (retroactively recorded 2026-05-24) · Deciders: @raphaelfh

## Context and Problem Statement

AI-assisted development tends to introduce silent architectural drift —
concept-vocabulary inconsistencies, layered-architecture violations,
missing tests, security gaps. Manual review catches some of these but
does not scale; running standard linters catches none.

## Decision

Treat the architectural quality autoloop (under
`.claude/skills/architectural-quality-loop`) as a first-class part of the
development workflow:

- Outputs land under `docs/superpowers/quality-runs/<datetime-scope>/`
  with `scope.md`, iteration files, and a `summary.md`.
- Each iteration converges through deterministic gates plus an LLM judge.
- Recurring incident classes (BOLA, TOCTOU, envelope drift, RLS gaps)
  become explicit checks in the `code-review` skill's prumo-specific
  checklist.

## Consequences

- Good — Drift is caught within a small number of iterations rather than
  surfacing in production incidents.
- Good — `docs/superpowers/quality-runs/` doubles as an audit trail for
  architectural decisions and their drivers.
- Neutral — Each run produces a folder of artefacts; the volume is
  manageable because runs are scoped (one slice at a time).
- Bad — The loop is only as good as the gate definitions; gates need
  periodic review.

## Validation

- 9 converged runs landed between 2026-05-19 and 2026-05-20 covering
  extraction services, frontend query-keys, the backend envelope batch,
  layered architecture, and the HITL session refactor (see
  `docs/superpowers/quality-runs/`).
- Each iteration includes pre/post snapshots demonstrating the gate
  delta.

## More Information

- [Quality runs index](../superpowers/quality-runs/README.md)
- Skill: `.claude/skills/architectural-quality-loop`
- [Original design spec](../superpowers/specs/2026-05-19-architectural-quality-autoloop-design.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0006-quality-autoloop-as-development-practice.md
git commit -m "docs(adr): 0006 — adopt architectural quality autoloop as practice"
```

---

## Phase 10 — Meta Files Update (CLAUDE.md, Constitution)

### Task 10.1 — Update root `CLAUDE.md` references to the new doc paths

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add frontmatter**

Prepend:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

```

- [ ] **Step 2: Replace path references**

Find-and-replace in `CLAUDE.md`:

| Old | New |
|---|---|
| `docs/architecture/extraction-hitl-architecture.md` | `docs/reference/extraction-hitl-architecture.md` |
| `docs/architecture/migrations.md` | `docs/reference/migrations.md` |
| `docs/architecture/deployment.md` | `docs/reference/deployment.md` |
| `docs/architecture/test-strategy.md` | `docs/reference/test-strategy.md` |
| `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` | (unchanged — that path stays) |

- [ ] **Step 3: Add a new "Documentation index" section**

Insert at the top after the introduction:

```markdown
## Documentation index

- [`docs/README.md`](docs/README.md) — full Diátaxis-organised index.
- [`docs/adr/`](docs/adr/) — recorded architecture decisions (MADR 4.0).
- [`docs/reference/`](docs/reference/) — schema, deployment, migrations, tests.
- [`docs/how-to/`](docs/how-to/) — seed database, observability.
- [`llms.txt`](llms.txt) — agent entry point.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): refresh paths after Diátaxis migration + add doc index"
```

### Task 10.2 — Update `.claude/CLAUDE.md` references

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Add frontmatter + replace paths**

Same pattern as 10.1 — frontmatter at the top, replace any `docs/architecture/*` path with `docs/reference/*`, update §6 "Architecture references" to point to the new paths.

- [ ] **Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude): refresh assistant guide paths after Diátaxis migration"
```

### Task 10.3 — Update `.specify/memory/constitution.md` if it references moved paths

**Files:**
- Modify (if needed): `.specify/memory/constitution.md`

- [ ] **Step 1: Search for stale paths**

```bash
grep -n "docs/architecture\|docs/templates\|docs/estrutura_database\|docs/planos\|docs/DATABASE_SEEDING\|docs/extraction-e2e-observability\|docs/ux_template\|specs/00" .specify/memory/constitution.md
```

- [ ] **Step 2: For each hit, replace with the new path**

- [ ] **Step 3: Commit (skip if no changes)**

```bash
git add .specify/memory/constitution.md
git commit -m "docs(constitution): refresh paths after Diátaxis migration"
```

### Task 10.4 — Add the conventional-commits note to CONTRIBUTING

**Files:**
- Modify: `.github/CONTRIBUTING.md`

- [ ] **Step 1: Append a section**

Add at the end of `.github/CONTRIBUTING.md`:

```markdown
## Commit message conventions

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `chore:` — tooling, deps, repo housekeeping
- `test:` — adding or refactoring tests
- `ci:` — CI configuration
- `refactor:` — refactor without behaviour change
- `perf:` — performance improvement

Scope (optional): `feat(extraction): …`, `fix(worker): …`, `docs(adr): …`.

Body / footer should explain **why**, not what. Mention the affected
spec or ADR when relevant (`Refs: docs/adr/0003-…`).
```

- [ ] **Step 2: Commit**

```bash
git add .github/CONTRIBUTING.md
git commit -m "docs(contributing): document conventional-commits requirement"
```

### Task 10.5 — Add `docs/superpowers/quality-runs/README.md` frontmatter + index refresh

**Files:**
- Modify: `docs/superpowers/quality-runs/README.md`

- [ ] **Step 1: Add frontmatter**

Prepend:

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

```

- [ ] **Step 2: If the file is currently a stub, expand it to list all converged runs**

For each subdirectory under `docs/superpowers/quality-runs/`, add a row to a table:

```markdown
| Run | Scope | Outcome |
|---|---|---|
| `2026-05-19-2010-extraction-services-converged` | extraction services | converged in 3 iterations |
| `2026-05-19-2255-frontend-querykeys-dashboard-converged` | dashboard querykeys | converged in 1 iteration |
| … | … | … |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/quality-runs/README.md
git commit -m "docs(superpowers): add status frontmatter + run index to quality-runs README"
```

### Task 10.6 — Add frontmatter to `docs/superpowers/design-system/sidebar-and-panels.md`

**Files:**
- Modify: `docs/superpowers/design-system/sidebar-and-panels.md`

- [ ] **Step 1: Prepend frontmatter**

```markdown
---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/design-system/sidebar-and-panels.md
git commit -m "docs(design-system): add status frontmatter"
```

---

## Phase 11 — Final Verification Gate

> **Why:** Phases 0–10 are mechanical. This phase is the proof. If any check fails, the corresponding earlier task left an issue; fix it before declaring done.

### Task 11.1 — Run the full lint suite locally

- [ ] **Step 1: markdownlint must be clean**

```bash
npx markdownlint-cli2 "**/*.md" "!node_modules/**" "!playwright-report/**" "!test-results/**" "!**/.pytest_cache/**" "!backend/alembic/versions/archive/**"
```

Expected: 0 violations. If non-zero, identify the file → fix → re-run.

- [ ] **Step 2: cspell must be clean**

```bash
npx -y cspell --config .github/cspell.json "**/*.md"
```

Expected: 0 unknowns. Add genuine domain words to `.github/cspell-words.txt`; fix actual typos in source.

- [ ] **Step 3: lychee must report 0 broken links**

```bash
docker run --rm -v "$PWD:/input" lycheeverse/lychee --config /input/.github/lychee.toml /input
```

Expected: `0 errors`. If non-zero, identify the file → fix the link.

- [ ] **Step 4: frontmatter check must pass**

```bash
bash scripts/docs/check-frontmatter.sh
```

Expected: `Frontmatter check passed for all tracked docs.`

- [ ] **Step 5: staleness warning is informational**

```bash
bash scripts/docs/check-staleness.sh
```

Expected: 0 stale docs (every touched doc has `last_reviewed: 2026-05-24`).

### Task 11.2 — Audit for residual Portuguese in canonical docs

- [ ] **Step 1: Spot-check with a heuristic**

Run:

```bash
grep -rln -iE '\b(você|não|também|estão|configuração|deploy é|aplicação)\b' --include='*.md' . \
  | grep -vE 'node_modules|playwright-report|test-results|\.pytest_cache|backend/alembic/versions/archive|docs/superpowers/specs/archive|docs/superpowers/plans/archive'
```

Expected: empty.

- [ ] **Step 2: For each hit, translate or move to the legacy archive**

If a doc is intentionally PT (e.g. captures a historical decision), move to
`docs/superpowers/specs/archive/` with a banner; otherwise translate.

- [ ] **Step 3: Commit any fixes**

```bash
git add <files>
git commit -m "docs: translate residual Portuguese flagged by Phase 11 audit"
```

### Task 11.3 — Audit for residual `render.yaml` / Render references

- [ ] **Step 1: Search**

```bash
grep -rln -iE 'render\.yaml|onrender\.com|render config' --include='*.md' . \
  | grep -vE 'node_modules|playwright-report|test-results|\.pytest_cache|backend/alembic/versions/archive|docs/superpowers/specs/archive|docs/superpowers/plans/archive'
```

Expected: empty.

- [ ] **Step 2: For each hit (outside archive), remove or replace with the Railway equivalent**

- [ ] **Step 3: Commit**

```bash
git commit -am "docs: scrub remaining Render references outside archive"
```

### Task 11.4 — Render the README on GitHub preview and verify visually

- [ ] **Step 1: Push a preview branch**

```bash
git push origin HEAD:docs/overhaul-2026
```

- [ ] **Step 2: Open the README on GitHub** (`https://github.com/raphaelfh/prumo/blob/docs/overhaul-2026/README.md`) and verify:

- Badges render
- Headings render with the correct hierarchy
- Tables render
- All links resolve (manual click on each link in the Documentation section)
- The status frontmatter is rendered as a YAML block (or hidden — both are fine)

- [ ] **Step 3: Trigger `docs-ci` and confirm green**

GitHub Actions tab → `docs-ci` → all five jobs (markdownlint, cspell, links,
frontmatter, staleness) must pass.

- [ ] **Step 4: Commit any final tweaks discovered during preview**

### Task 11.5 — Update the plan's status to `shipped`

**Files:**
- Modify: this plan file (`docs/superpowers/plans/2026-05-24-documentation-overhaul-2026.md`)

- [ ] **Step 1: Update the frontmatter**

```markdown
---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
shipped_on: 'YYYY-MM-DD'
---
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-24-documentation-overhaul-2026.md
git commit -m "docs(plan): mark documentation-overhaul-2026 as shipped"
```

### Task 11.6 — Open the PR

- [ ] **Step 1: Use `gh pr create`**

```bash
gh pr create --title "docs: 2026 documentation overhaul" --body "$(cat <<'EOF'
## Summary

- Brings the entire Markdown surface to a coherent 2026 documentation standard.
- English everywhere, Diátaxis organisation, CI gates (markdownlint, cspell, lychee, frontmatter, staleness).
- 5 retroactive ADRs (Alembic split, kind discriminator, Render→Railway, AGPL, quality autoloop) + MADR template.
- Community files consolidated under `.github/`; root keeps only README + LICENSE.
- Legacy `specs/00X/` archived under `docs/superpowers/specs/archive/legacy-spec-kit/`.
- ROADMAP migrated to a thin pointer + GitHub Project link.
- Render references and `LICENSE.txt` removed.

Implements plan: [`docs/superpowers/plans/2026-05-24-documentation-overhaul-2026.md`](docs/superpowers/plans/2026-05-24-documentation-overhaul-2026.md).

## Test plan

- [ ] `docs-ci` workflow green (markdownlint, cspell, links, frontmatter, staleness)
- [ ] Manual GitHub preview of README — every link clicked
- [ ] `make test-backend` still green (no code paths touched)
- [ ] `npm test -- --run` still green (no code paths touched)
EOF
)"
```

- [ ] **Step 2: Verify the PR has CI green**

Wait for `docs-ci` to finish; if any job fails, fix the underlying doc and push the fix.

---

## Self-review checklist (run before declaring the plan complete)

- [ ] Every audit item from the 2026-05-24 report has at least one task above (R1 idiom policy → Tasks 5.1, 5.2, 5.3, 5.4, 6.6, 7.3; R2 spec consolidation → Phase 4; R3 community files → Phase 2; R4 ROADMAP → Phase 8; R5 LICENSE.txt → 1.1; R6 CHARMS version → 7.1–7.3; R7 ux_template → 7.6; R8 Diátaxis → Phase 3, Phase 6, Phase 7; R9 ADRs → Phase 9; R10 CI lint → Phase 0; R11 specs/007 → 1.4 + 4.6; R12 status badge → frontmatter pattern in every move/rewrite task).
- [ ] No placeholders ("TBD", "implement later", "add appropriate error handling"). Every code block is concrete.
- [ ] Every cross-reference is mutual: when a file moves, both the moved file's outbound and every other file's inbound get updated in the same task.
- [ ] Phase 0 (CI gates) is genuinely first — every later phase relies on the gates for verification.
- [ ] Phase 11 has an automated gate (`docs-ci`) plus a manual preview step.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-documentation-overhaul-2026.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good fit because there are many independent file-level tasks.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach do you want?**

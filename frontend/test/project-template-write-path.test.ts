/**
 * Regression guard: `project_extraction_templates` rows are created ONLY by
 * the API layer.
 *
 * A deferred CONSTRAINT TRIGGER (`project_extraction_templates_active_version`,
 * migration 0004) requires every project template to own an *active*
 * `extraction_template_versions` row at COMMIT time, and the partial unique
 * index `uq_one_active_extraction_template_per_project` (migration 0014)
 * allows exactly one active extraction template per project. A single
 * PostgREST insert can satisfy neither: it commits alone, and it cannot
 * deactivate the incumbent sibling first.
 *
 * Both failure modes are observable — a direct insert returns
 * `409 / 23505` (duplicate key) when the project already has an active
 * extraction template, and `400 / 23514` ("has no active version") when it
 * does not. Creation therefore stays server-side, where
 * `deactivate_sibling_extraction_templates` + `TemplateVersionService`
 * publish v1 in one transaction.
 *
 * See docs/reference/extraction-hitl-architecture.md §4.3.
 *
 * Reads are deliberately NOT covered here: the frontend still reads this
 * table via PostgREST in several services, and that consolidation is tracked
 * separately (CLAUDE.md "Current focus").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(here, '..');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
]);

/** Tables whose rows carry the active-version invariant. */
const GUARDED_TABLES = ['project_extraction_templates', 'extraction_template_versions'];

const WRITE_VERB = /\.(insert|update|delete|upsert)\s*\(/;

function* sourceFiles(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(resolve(dir, entry.name));
    } else if (/\.tsx?$/.test(entry.name)) {
      yield resolve(dir, entry.name);
    }
  }
}

/**
 * Find PostgREST write chains against `<table>`. The query builder is routinely
 * split across lines, so this anchors on `.from('<table>')` and then inspects
 * the remainder of that statement (up to the terminating `;`) for a write verb
 * — a line-by-line regex would miss the common fluent style.
 */
function writeSites(source: string, table: string): number[] {
  const anchor = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, 'g');
  const hits: number[] = [];
  for (const match of source.matchAll(anchor)) {
    const start = match.index + match[0].length;
    const statement = source.slice(start, start + 400).split(';')[0];
    if (WRITE_VERB.test(statement)) {
      hits.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return hits;
}

/** One walk of the tree, every guarded table checked per file. */
function findOffenders(): Map<string, string[]> {
  const byTable = new Map(GUARDED_TABLES.map((table) => [table, [] as string[]]));

  const self = relative(FRONTEND_ROOT, fileURLToPath(import.meta.url)).split(sep).join('/');

  for (const file of sourceFiles(FRONTEND_ROOT)) {
    const rel = relative(FRONTEND_ROOT, file).split(sep).join('/');
    // `e2e/` seeds fixtures out-of-band through the service-role admin
    // client, which is not the app's data path.
    if (rel.startsWith('e2e/')) continue;
    // This file quotes an offending snippet as the canary fixture below.
    if (rel === self) continue;

    const source = readFileSync(file, 'utf8');
    for (const table of GUARDED_TABLES) {
      if (!source.includes(table)) continue;
      for (const line of writeSites(source, table)) {
        byTable.get(table)!.push(`frontend/${rel}:${line}`);
      }
    }
  }
  return byTable;
}

describe('project_extraction_templates is written only by the API layer', () => {
  const offenders = findOffenders();

  for (const table of GUARDED_TABLES) {
    it(`no frontend source writes to ${table}`, () => {
      expect(offenders.get(table)).toEqual([]);
    });
  }

  // Without this, a scanner broken by a future edit would report "no
  // offenders" forever and the guard would lie green. This is the exact
  // shape of the call this change deleted from templateService.ts.
  it('detects the write it was built to catch', () => {
    const removedCode = `
      const {data: template, error} = await supabase
        .from('project_extraction_templates')
        .insert({project_id: params.projectId, is_active: true})
        .select()
        .single();
    `;
    expect(writeSites(removedCode, 'project_extraction_templates')).toHaveLength(1);
    // A read of the same table is legal and must not trip the guard. (Split
    // across lines so this fixture is not itself a single-read-path
    // violation for scripts/fitness/check_frontend_data_path.py.)
    const read = `
      await supabase
        .from('project_extraction_templates')
        .select('*');
    `;
    expect(writeSites(read, 'project_extraction_templates')).toEqual([]);
  });
});

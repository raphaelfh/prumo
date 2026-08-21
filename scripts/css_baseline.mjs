// scripts/css_baseline.mjs
// Compiles frontend/index.css exactly as the app pipeline does and emits a
// sorted `selector -> declarations` snapshot.
//
// Why this exists: the Tailwind v4 migration has no visual-regression net
// (the E2E suite makes zero geometry/screenshot assertions, and vitest asserts
// class *strings* in jsdom, which applies no stylesheet). The compiled-CSS
// diff is therefore the primary gate. Recording the baseline BEFORE the port
// is what makes it a gate at all — recorded after, it certifies the migration
// against itself.
//
//   node scripts/css_baseline.mjs            # write scripts/css_baseline.txt
//   node scripts/css_baseline.mjs --check    # diff against the committed file
//
// Version-agnostic on purpose: it loads the repo's own postcss.config.js, so
// the same script drives Tailwind v3 and v4 without edits.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postcss from 'postcss';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = resolve(root, 'frontend/index.css');
const SNAPSHOT = resolve(root, 'scripts/css_baseline.txt');

const { default: pcConfig } = await import(pathToFileURL(resolve(root, 'postcss.config.js')));
const plugins = await Promise.all(
  Object.entries(pcConfig.plugins ?? {}).map(async ([name, opts]) => {
    const mod = await import(name);
    return (mod.default ?? mod)(opts);
  }),
);

const css = await readFile(INPUT, 'utf8');
const result = await postcss(plugins).process(css, { from: INPUT });

// Collapse the AST to `at-rule context | selector -> sorted declarations`.
// Sorting makes the snapshot order-independent, so a diff shows semantic
// change rather than the order Tailwind happened to emit utilities in.
const rows = [];
result.root.walkRules((rule) => {
  const context = [];
  for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
    context.unshift(p.name ? `@${p.name} ${p.params}`.trim() : '');
  }
  const decls = [];
  rule.walkDecls((d) => decls.push(`${d.prop}:${d.value}${d.important ? '!important' : ''}`));
  decls.sort();
  const prefix = context.filter(Boolean).join(' >> ');
  rows.push(`${prefix ? prefix + ' >> ' : ''}${rule.selector.replace(/\s+/g, ' ')} { ${decls.join('; ')} }`);
});

// Bare at-rules that carry no nested rule (@keyframes steps, @property, ...)
// still matter — a dropped @property changes rendering with no rule diff.
result.root.walkAtRules((at) => {
  if (at.name === 'property' || at.name === 'font-face') {
    const decls = [];
    at.walkDecls((d) => decls.push(`${d.prop}:${d.value}`));
    decls.sort();
    rows.push(`@${at.name} ${at.params} { ${decls.join('; ')} }`);
  }
});

rows.sort();
const out = rows.join('\n') + '\n';

const args = process.argv.slice(2);
if (args.includes('--check')) {
  const prev = await readFile(SNAPSHOT, 'utf8').catch(() => null);
  if (prev === null) {
    console.error(`No baseline at ${SNAPSHOT}. Run without --check first.`);
    process.exit(1);
  }
  if (prev === out) {
    console.log(`CSS baseline unchanged (${rows.length} rules).`);
    process.exit(0);
  }
  console.error(`CSS baseline CHANGED: ${prev.split('\n').length - 1} -> ${rows.length} rules.`);
  console.error('Review the diff, then re-record with: node scripts/css_baseline.mjs');
  process.exit(1);
}

await writeFile(SNAPSHOT, out);
console.log(`Wrote ${SNAPSHOT} (${rows.length} rules, ${out.length} bytes).`);

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
// Tailwind v4 wraps ALL of its output in native cascade layers; v3 emits no
// native layers at all. That wrapper is uniform, expected, and carries no
// comparative signal — normalising it away keeps a v3 -> v4 diff semantic
// instead of 1400 lines of identical prefix churn. Normalising is a no-op on
// v3 output. Nested at-rules (@media, @supports, @container) are KEPT: those
// carry real signal.
const TW_LAYERS = new Set(['theme', 'base', 'components', 'utilities']);

// v4 emits genuinely NESTED css (`.outline-hidden { …; @media (forced-colors:
// active) { … } }`); v3 emits everything flat. A recursive decl walk would
// silently hoist those nested declarations into the parent rule and hide the
// context they are actually gated on, so this walks the tree explicitly and
// only ever takes DIRECT declaration children.
const rows = [];

// v3 emits `.foo>svg`, v4 emits `.foo > svg` for the identical selector.
// Collapse whitespace around combinators so the diff shows semantic change
// rather than formatting. Applied identically to both versions.
const normSel = (sel) =>
  sel
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/,\s*/g, ',')
    .trim();

// v3 emits `@media (min-width: 640px)`; v4 emits the modern range form in rem,
// `@media (width >= 40rem)`. Same breakpoint (this app does not override the
// root font size, so 1rem = 16px). Canonicalise both to `(width >= Npx)` so a
// genuinely MOVED breakpoint still shows up while the syntax change does not.
const REM_PX = 16;
const normAtRule = (name, params) => {
  let p = (params || '').trim();
  p = p.replace(/\(\s*min-width:\s*([\d.]+)(px|rem)\s*\)/g, (_, n, u) =>
    `(width >= ${u === 'rem' ? Number(n) * REM_PX : Number(n)}px)`);
  p = p.replace(/\(\s*width\s*>=\s*([\d.]+)(px|rem)\s*\)/g, (_, n, u) =>
    `(width >= ${u === 'rem' ? Number(n) * REM_PX : Number(n)}px)`);
  return `@${name} ${p}`.trim();
};

// v4 emits nested RULES too (`.prose { :where(p):not(…) { … } }`), where v3
// emitted the same thing flat as `.prose :where(p):not(…)`. Resolve nesting
// the way CSS does — substitute `&`, otherwise treat it as a descendant — so
// the two versions produce comparable selectors instead of 157 parentless
// fragments that look like utilities appearing and disappearing.
function compose(parent, childSel) {
  const child = normSel(childSel);
  if (!parent) return child;
  return child
    .split(',')
    .map((part) => {
      const p = part.trim();
      return p.includes('&') ? p.replace(/&/g, parent) : `${parent} ${p}`;
    })
    .join(', ');
}

function visit(node, selector, context) {
  const decls = node.nodes?.filter((n) => n.type === 'decl') ?? [];
  if (decls.length && selector) {
    const body = decls
      .map((d) => `${d.prop}:${d.value}${d.important ? '!important' : ''}`)
      .sort()
      .join('; ');
    const prefix = context.length ? context.join(' >> ') + ' >> ' : '';
    rows.push(`${prefix}${selector} { ${body} }`);
  }
  for (const child of node.nodes ?? []) {
    if (child.type === 'rule') {
      visit(child, compose(selector, child.selector), context);
    } else if (child.type === 'atrule') {
      if (child.name === 'layer' && TW_LAYERS.has((child.params || '').trim())) {
        visit(child, selector, context);
      } else if (child.name === 'keyframes') {
        visit(child, selector, [...context, `@keyframes ${child.params}`]);
      } else {
        visit(child, selector, [...context, normAtRule(child.name, child.params)]);
      }
    }
  }
}

visit(result.root, null, []);

// Bare at-rules that carry no nested rule (@property, @font-face) still
// matter — a dropped @property changes rendering with no rule diff.
result.root.walkAtRules((at) => {
  if (at.name === 'property' || at.name === 'font-face') {
    const decls = (at.nodes ?? [])
      .filter((n) => n.type === 'decl')
      .map((d) => `${d.prop}:${d.value}`)
      .sort();
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

#!/usr/bin/env node
// Typecheck ratchet: fail only if frontend tsc errors EXCEED the committed
// budget (a ceiling). Counts can differ slightly across environments (Node
// version / module resolution), so this enforces a ceiling, not an exact pin.
// Lower scripts/typecheck-budget.txt in the PR that fixes errors to tighten it.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const budget = Number(readFileSync(join(here, 'typecheck-budget.txt'), 'utf8').trim());

let out = '';
try {
  out = execSync('npx tsc -p tsconfig.app.json --noEmit', { encoding: 'utf8' });
} catch (e) {
  out = `${e.stdout || ''}${e.stderr || ''}`;
}
const count = (out.match(/error TS\d+/g) || []).length;
console.log(`typecheck errors: ${count} (budget ${budget})`);

if (count > budget) {
  console.error(`❌ Typecheck errors increased: ${count} > budget ${budget}.`);
  console.error('Fix the new error(s) or do not introduce them.');
  process.exit(1);
}
if (count < budget) {
  console.log(`note: ${count} < budget ${budget} — lower scripts/typecheck-budget.txt to ${count} to ratchet down.`);
}
console.log('✅ At or under budget.');

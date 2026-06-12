// scripts/enumerate_compiler_bailouts.mjs
// Lists every frontend file the React Compiler fails to compile, with
// error categories. A panicking build stops at the FIRST failure; this
// script sweeps ALL files in one pass. Uses: sweep progress + PR-body
// counts (zero-bailouts plan), and previewing new bailouts before a
// babel-plugin-react-compiler upgrade. Files opted out via the
// 'use no memo' directive are skipped by the compiler and never listed.
// Run from the repo root: node scripts/enumerate_compiler_bailouts.mjs
import { transformAsync } from '@babel/core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const entries = await readdir('frontend', { recursive: true });
const files = entries
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f))
  .filter((f) => !/(\.test\.|\.spec\.|__tests__|__mocks__)/.test(f))
  .map((f) => path.join('frontend', f));

let failures = 0;
for (const file of files.sort()) {
  const code = await readFile(file, 'utf8');
  try {
    await transformAsync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]],
    });
  } catch (e) {
    failures += 1;
    const kinds = [...new Set(
      [...String(e.message).matchAll(/^\s*(Todo|Invariant|InvalidReact|Compilation Skipped): (.+)$/gm)]
        .map((m) => `${m[1]}: ${m[2]}`),
    )];
    console.log(`${file}\n   ${kinds.join('\n   ') || String(e.message).split('\n')[0]}`);
  }
}
console.log(`\nBAILOUT FILES: ${failures} of ${files.length}`);
process.exit(failures === 0 ? 0 : 1);

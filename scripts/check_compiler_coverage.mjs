// scripts/check_compiler_coverage.mjs
// Proves the Vite pipeline applies the React Compiler to BOTH a .tsx
// component and a plain .ts hook (hooks have no JSX — a JSX-only Babel
// include filter would silently skip them). Exits 1 if any target lacks
// compiler artifacts. Run: node scripts/check_compiler_coverage.mjs
//
// Detection notes (learned the hard way):
// - Vite's import analysis rewrites `react/compiler-runtime` to
//   `/node_modules/.vite/deps/react_compiler-runtime.js?v=<hash>`, so the
//   check matches the rewrite-stable substring 'compiler-runtime'.
// - Each canary must be a file the compiler CAN compile. Functions with
//   try/finally bail out (babel-plugin-react-compiler v1 limitation:
//   "Todo: Handle TryStatement with a finalizer"), so loader hooks like
//   useProjectsList are unusable as canaries.
import { createServer } from 'vite';

const TARGETS = [
  '/frontend/components/ui/sidebar.tsx', // .tsx component
  '/frontend/hooks/useKeyboardShortcuts.ts', // .ts hook, no JSX, no try/finally
];

const server = await createServer({ logLevel: 'silent' });
let failed = false;
try {
  for (const target of TARGETS) {
    let result;
    try {
      result = await server.environments.client.transformRequest(target);
    } catch (e) {
      console.log(`ERR  ${target} — ${e.message}`);
      failed = true;
      continue;
    }
    const ok = Boolean(result?.code?.includes('compiler-runtime'));
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${target}`);
    if (!ok) failed = true;
  }
} finally {
  await server.close();
}
if (failed) {
  console.error('React Compiler is NOT applied to all targets by the Vite pipeline.');
  process.exit(1);
}
console.log('Compiler coverage proof: PASS');

// scripts/check_compiler_coverage.mjs
// Proves the Vite pipeline applies the React Compiler to BOTH a .tsx
// component and a plain .ts hook (hooks have no JSX — a JSX-only Babel
// include filter would silently skip them). Exits 1 if any target lacks
// compiler artifacts. Run: node scripts/check_compiler_coverage.mjs
import { createServer } from 'vite';

const TARGETS = [
  '/frontend/components/ui/sidebar.tsx', // .tsx component
  '/frontend/hooks/useProjectsList.ts', // .ts hook, no JSX
];

const server = await createServer({ logLevel: 'silent' });
let failed = false;
try {
  for (const target of TARGETS) {
    const result = await server.transformRequest(target);
    const ok = Boolean(result?.code?.includes('react/compiler-runtime'));
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

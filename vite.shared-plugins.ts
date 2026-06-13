/**
 * Single source of truth for the React + React Compiler plugin pair.
 *
 * BOTH vite.config.ts (app build/dev) and vitest.config.ts (test pipeline)
 * import this — if they drifted, tests could silently stop exercising
 * compiled output while staying green (uncompiled code is semantically
 * identical, just unmemoized). scripts/check_compiler_coverage.mjs proves
 * the app pipeline; sharing this module extends that guarantee to vitest.
 *
 * reactCompilerPreset is environment-gated by @vitejs/plugin-react
 * (consumer === 'client'); vitest's transform qualifies — verified by the
 * hook-source probe documented in the compiler-enablement plan.
 */
import react, {reactCompilerPreset} from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import type {PluginOption} from "vite";

export function reactWithCompiler(): PluginOption[] {
  // panicThreshold 'all_errors': any component/hook the compiler cannot
  // compile fails the build AND vitest (shared preset). Escape hatch for
  // genuinely uncompilable files: 'use no memo' + a // kept: comment.
  // Full-tree listing: node scripts/enumerate_compiler_bailouts.mjs
  return [react(), babel({presets: [reactCompilerPreset({panicThreshold: 'all_errors'})]})];
}

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
    // Never descend into nested checkouts. `.claude/worktrees/<wt>` holds full
    // repo copies; without this, `eslint .` from the parent lints them too and
    // the typed parser reports "multiple candidate TSConfigRootDirs" per file.
    {ignores: [".claude/**", "dist/**", "build/**", "coverage/**", "node_modules/**"]},
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      // Pin the tsconfig root to this config file's directory so the parser
      // never has to guess it. A sibling worktree under .claude/worktrees/
      // otherwise makes the root ambiguous and floods every file with a
      // "No tsconfigRootDir was set" parsing error.
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React Compiler rules from eslint-plugin-react-hooks 7 run at their
      // recommended error level. The 94-finding debt that once held them at
      // "warn" was burned down in PRs #260–#265 — keep them at error so new
      // violations fail CI instead of accumulating.
      ...reactHooks.configs.recommended.rules,
        "react-hooks/exhaustive-deps": "off",
        "react-refresh/only-export-components": "off",
        "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { 
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "prefer-const": "error",
        "no-console": ["warn", {allow: ["warn", "error", "time", "timeEnd", "group", "groupEnd"]}],
    },
  },
  {
      files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "frontend/test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        vi: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
    },
  },
);

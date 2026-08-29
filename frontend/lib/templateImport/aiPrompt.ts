/// <reference types="vite/client" />
/**
 * The prompt users hand to an AI assistant to author a `prumo-template@1`
 * file, and the example that backs both it and the Download example button.
 *
 * The example is embedded with `?raw`, so the prompt cannot carry a stale
 * copy of it, and the rules come from `lib/copy/templateConfig` — the same
 * array the "How to build this file" accordion renders. The drift that
 * remains (prose vs. the backend schema) is covered by
 * `backend/tests/unit/test_template_portable_example_drift.py`.
 */

import exampleRaw from './exampleTemplate.json?raw';
import {templateConfig} from '@/lib/copy';

/** The example document, verbatim. Also served by Download example. */
export const EXAMPLE_TEMPLATE_JSON = exampleRaw;

/** Constant, not a function: it takes no input and never varies. */
export const AI_TEMPLATE_PROMPT = [
  templateConfig.importPromptIntro,
  '',
  ...templateConfig.importGuidanceRules.map((rule) => `- ${rule}`),
  '',
  templateConfig.importPromptExampleLabel,
  '',
  EXAMPLE_TEMPLATE_JSON.trim(),
  '',
  templateConfig.importPromptOutputOnly,
].join('\n');

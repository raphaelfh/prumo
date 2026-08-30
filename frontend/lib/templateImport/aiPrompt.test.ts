import {describe, expect, it} from 'vitest';

import {templateConfig} from '@/lib/copy';

import {AI_TEMPLATE_PROMPT, EXAMPLE_TEMPLATE_JSON} from './aiPrompt';

/**
 * The prompt is what a user pastes into an assistant, so these assert the
 * CONTENT an assistant needs, not the wiring. That the prompt embeds the
 * example is guaranteed by the `?raw` import rather than by a test; the
 * prose-vs-schema drift is guarded backend-side.
 */
describe('AI_TEMPLATE_PROMPT', () => {
  it('carries every format rule the accordion shows', () => {
    for (const rule of templateConfig.importGuidanceRules) {
      expect(AI_TEMPLATE_PROMPT).toContain(rule);
    }
  });

  it('names all six field types the schema accepts', () => {
    for (const type of ['text', 'number', 'date', 'select', 'multiselect', 'boolean']) {
      expect(AI_TEMPLATE_PROMPT).toContain(type);
    }
  });

  it('embeds a parseable example and demands bare JSON back', () => {
    // The assistant is told to emit a document shaped like this one, so the
    // example itself must be valid JSON — a broken example teaches the
    // assistant to produce broken output.
    const parsed = JSON.parse(EXAMPLE_TEMPLATE_JSON) as {prumo_template: number; kind: string};
    expect(parsed.prumo_template).toBe(1);
    expect(parsed.kind).toBe('extraction');
    expect(AI_TEMPLATE_PROMPT).toContain(EXAMPLE_TEMPLATE_JSON.trim());
    expect(AI_TEMPLATE_PROMPT).toContain(templateConfig.importPromptOutputOnly);
  });
});

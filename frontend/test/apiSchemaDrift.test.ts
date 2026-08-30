/**
 * Zod ↔ Pydantic drift guard for the B-7 create-field contract
 * (panel 13).
 *
 * `ExtractionFieldSchema` (frontend/types/extraction.ts) and
 * `TemplateFieldCreateRequest` (backend/app/schemas/template_structure.py)
 * must enforce the SAME constraints — the frontend validates before it
 * sends, and a looser/stricter server would either reject valid drafts
 * or accept rows the editor cannot re-render. This suite pins BOTH
 * sides to the same literals: the committed openapi.json carries the
 * server's numbers verbatim, and behavioral safeParse probes pin the
 * Zod side (so a drift on EITHER side fails here, without a backend).
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import {ExtractionFieldSchema} from '@/types/extraction';

interface OpenApiProperty {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  minimum?: number;
  default?: unknown;
  minItems?: number;
  maxItems?: number;
  items?: OpenApiProperty;
  anyOf?: OpenApiProperty[];
  type?: string;
}

interface OpenApiDocument {
  components: {
    schemas: Record<
      string,
      {properties: Record<string, OpenApiProperty>; required?: string[]}
    >;
  };
}

// Vitest runs from the repo root (project convention); jsdom rewrites
// import.meta.url to an http scheme, so resolve from cwd instead.
const openapi = JSON.parse(
  readFileSync(resolve(process.cwd(), 'frontend/types/api/openapi.json'), 'utf-8'),
) as OpenApiDocument;

const createRequest = openapi.components.schemas.TemplateFieldCreateRequest;

/** Optional-nullable Pydantic fields serialize as anyOf [shape, null] —
 * return the non-null variant (or the property itself when plain). */
function shapeOf(name: string): OpenApiProperty {
  const property = createRequest.properties[name];
  if (!property) throw new Error(`missing property in openapi: ${name}`);
  if (!property.anyOf) return property;
  const nonNull = property.anyOf.find((variant) => variant.type !== 'null');
  if (!nonNull) throw new Error(`only-null anyOf in openapi: ${name}`);
  return nonNull;
}

const BASE = {name: 'field_name', label: 'Label', field_type: 'text'};

/** Does the Zod schema accept BASE with this patch applied? */
function zodAccepts(patch: Record<string, unknown>): boolean {
  return ExtractionFieldSchema.safeParse({...BASE, ...patch}).success;
}

describe('create-field contract — server literals (openapi.json)', () => {
  it('name: snake_case pattern, 2..50', () => {
    const name = shapeOf('name');
    expect(name.pattern).toBe('^[a-z][a-z0-9_]*$');
    expect(name.minLength).toBe(2);
    expect(name.maxLength).toBe(50);
  });

  it('label 1..100, description ≤500, unit ≤50, llm_description ≤1000', () => {
    expect(shapeOf('label')).toMatchObject({minLength: 1, maxLength: 100});
    expect(shapeOf('description').maxLength).toBe(500);
    expect(shapeOf('unit').maxLength).toBe(50);
    expect(shapeOf('llm_description').maxLength).toBe(1000);
  });

  it('field_type enum matches the Zod enum exactly', () => {
    expect(shapeOf('field_type').enum).toEqual([
      ...ExtractionFieldSchema.shape.field_type.options,
    ]);
  });

  it('allowed_values 1..100 items; allowed_units 1..20 items of ≤50 chars', () => {
    expect(shapeOf('allowed_values')).toMatchObject({minItems: 1, maxItems: 100});
    const units = shapeOf('allowed_units');
    expect(units).toMatchObject({minItems: 1, maxItems: 20});
    expect(units.items?.maxLength).toBe(50);
  });

  it('other_label ≤100 with NO default (the dead pt-BR default died on both sides, panel 16); other_placeholder ≤200', () => {
    const otherLabel = createRequest.properties.other_label;
    expect(shapeOf('other_label').maxLength).toBe(100);
    expect(otherLabel).not.toHaveProperty('default');
    expect(shapeOf('other_placeholder').maxLength).toBe(200);
  });

  it('sort_order ≥0 defaulting 0; the opt-in booleans default false', () => {
    expect(createRequest.properties.sort_order).toMatchObject({
      minimum: 0,
      default: 0,
    });
    for (const flag of ['allow_other', 'allows_not_applicable', 'allows_not_evaluated']) {
      expect(createRequest.properties[flag]).toMatchObject({
        type: 'boolean',
        default: false,
      });
    }
  });

  it('allows_no_information defaults TRUE, unlike its two siblings (migration 0062)', () => {
    // The marker was universal before the column existed, so an omitting
    // client must keep it. A copy-paste of the `false` above would silently
    // retire the affordance on every field created through this API.
    expect(createRequest.properties.allows_no_information).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });
});

describe('create-field contract — Zod behavioral probes (same literals)', () => {
  it('name: 2..50 snake_case', () => {
    expect(zodAccepts({name: 'ab'})).toBe(true);
    expect(zodAccepts({name: 'a'})).toBe(false);
    expect(zodAccepts({name: `a${'b'.repeat(49)}`})).toBe(true);
    expect(zodAccepts({name: `a${'b'.repeat(50)}`})).toBe(false);
    expect(zodAccepts({name: 'Upper_case'})).toBe(false);
    expect(zodAccepts({name: '1leading'})).toBe(false);
  });

  it('label 1..100, description ≤500, unit ≤50, llm_description ≤1000', () => {
    expect(zodAccepts({label: ''})).toBe(false);
    expect(zodAccepts({label: 'x'.repeat(100)})).toBe(true);
    expect(zodAccepts({label: 'x'.repeat(101)})).toBe(false);
    expect(zodAccepts({description: 'x'.repeat(500)})).toBe(true);
    expect(zodAccepts({description: 'x'.repeat(501)})).toBe(false);
    expect(zodAccepts({unit: 'x'.repeat(50)})).toBe(true);
    expect(zodAccepts({unit: 'x'.repeat(51)})).toBe(false);
    expect(zodAccepts({llm_description: 'x'.repeat(1000)})).toBe(true);
    expect(zodAccepts({llm_description: 'x'.repeat(1001)})).toBe(false);
  });

  it('allowed_values 1..100 unique; allowed_units 1..20 unique of ≤50 chars', () => {
    expect(zodAccepts({allowed_values: []})).toBe(false);
    expect(
      zodAccepts({allowed_values: Array.from({length: 100}, (_, i) => `v${i}`)}),
    ).toBe(true);
    expect(
      zodAccepts({allowed_values: Array.from({length: 101}, (_, i) => `v${i}`)}),
    ).toBe(false);
    expect(zodAccepts({allowed_values: ['dup', 'dup']})).toBe(false);
    expect(zodAccepts({allowed_units: []})).toBe(false);
    expect(
      zodAccepts({allowed_units: Array.from({length: 20}, (_, i) => `u${i}`)}),
    ).toBe(true);
    expect(
      zodAccepts({allowed_units: Array.from({length: 21}, (_, i) => `u${i}`)}),
    ).toBe(false);
    expect(zodAccepts({allowed_units: ['dup', 'dup']})).toBe(false);
    expect(zodAccepts({allowed_units: ['x'.repeat(51)]})).toBe(false);
  });

  it('other_label ≤100 and NEVER defaulted; other_placeholder ≤200; sort_order ≥0', () => {
    expect(zodAccepts({other_label: 'x'.repeat(100)})).toBe(true);
    expect(zodAccepts({other_label: 'x'.repeat(101)})).toBe(false);
    const parsed = ExtractionFieldSchema.parse(BASE);
    expect(parsed.other_label).toBeUndefined();
    expect(zodAccepts({other_placeholder: 'x'.repeat(200)})).toBe(true);
    expect(zodAccepts({other_placeholder: 'x'.repeat(201)})).toBe(false);
    expect(zodAccepts({sort_order: 0})).toBe(true);
    expect(zodAccepts({sort_order: -1})).toBe(false);
  });
});

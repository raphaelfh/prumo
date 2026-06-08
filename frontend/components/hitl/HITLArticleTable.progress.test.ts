import { describe, expect, it } from 'vitest';

import type { TemplateEntityTypeWithFields } from '@/hooks/extraction/useTemplateEntityTypes';
import { computeRequiredFieldProgress } from '@/lib/extraction/progress';
import type { ExtractionField } from '@/types/extraction';

import { computeArticleProgress } from './HITLArticleTable';

function field(id: string, is_required: boolean): ExtractionField {
  return { id, is_required } as ExtractionField;
}
function et(id: string, fields: ExtractionField[]): TemplateEntityTypeWithFields {
  return { id, fields };
}
function instance(id: string, entityTypeId: string, status = 'pending') {
  return { id, article_id: 'a1', template_id: 't1', entity_type_id: entityTypeId, status };
}
function article(
  instances: ReturnType<typeof instance>[],
  values: { instance_id: string; field_id: string; value: unknown; decision: string }[],
) {
  return {
    id: 'a1',
    title: 'x',
    authors: null,
    publication_year: null,
    created_at: '2026-01-01',
    instances,
    values,
  };
}

describe('computeArticleProgress (HITL list)', () => {
  const entityTypes = [et('e1', [field('f1', true), field('f2', true), field('opt', false)])];

  it('agrees with the canonical header metric for the same data (the bug regression)', () => {
    const art = article(
      [instance('i1', 'e1')],
      [{ instance_id: 'i1', field_id: 'f1', value: { value: 'x' }, decision: 'edit' }],
    );
    const listPct = computeArticleProgress(art, entityTypes, true);
    const headerPct = computeRequiredFieldProgress({ i1_f1: 'x' }, entityTypes).completionPercentage;
    expect(listPct).toBe(50);
    expect(listPct).toBe(headerPct); // same article => same % in list and header
  });

  it("cardinality='many': 2 instances, only one filled => 50% (not 100)", () => {
    const ets = [et('e1', [field('f1', true), field('f2', true)])];
    const art = article(
      [instance('m1', 'e1'), instance('m2', 'e1')],
      [
        { instance_id: 'm1', field_id: 'f1', value: { value: 'a' }, decision: 'edit' },
        { instance_id: 'm1', field_id: 'f2', value: { value: 'b' }, decision: 'edit' },
      ],
    );
    // denominator = 2 required × 2 instances = 4; filled = 2 => 50%
    expect(computeArticleProgress(art, ets, true)).toBe(50);
  });

  it('all instances completed => 100% (terminal shortcut kept)', () => {
    const art = article([instance('i1', 'e1', 'completed')], []);
    expect(computeArticleProgress(art, entityTypes, true)).toBe(100);
  });

  it('QA fallback (no required fields) => instance-based, not a 0% flatline', () => {
    const ets = [et('e1', [field('f1', false)])];
    const art = article(
      [instance('i1', 'e1'), instance('i2', 'e1')],
      [{ instance_id: 'i1', field_id: 'f1', value: { value: 'x' }, decision: 'edit' }],
    );
    expect(computeArticleProgress(art, ets, false)).toBe(50); // 1 of 2 instances touched
  });

  it('empty wrapped value {value:""} is not counted as filled', () => {
    const art = article(
      [instance('i1', 'e1')],
      [{ instance_id: 'i1', field_id: 'f1', value: { value: '' }, decision: 'edit' }],
    );
    expect(computeArticleProgress(art, entityTypes, true)).toBe(0);
  });

  it('no instances => 0%', () => {
    expect(computeArticleProgress(article([], []), entityTypes, true)).toBe(0);
  });
});

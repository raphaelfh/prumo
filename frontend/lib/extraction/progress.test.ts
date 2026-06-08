import { describe, expect, it } from 'vitest';

import type { ExtractionField } from '@/types/extraction';

import { computeRequiredFieldProgress, type ProgressEntityProjection } from './progress';

function field(id: string, is_required: boolean): ExtractionField {
  // Only id + is_required are read by the formula.
  return { id, is_required } as ExtractionField;
}

function et(id: string, fields: ExtractionField[]): ProgressEntityProjection {
  return { id, fields };
}

describe('computeRequiredFieldProgress', () => {
  it('counts required (instance × field) pairs filled', () => {
    const entityTypes = [et('e1', [field('f1', true), field('f2', true), field('fo', false)])];
    const r = computeRequiredFieldProgress({ i1_f1: 'x' }, entityTypes);
    expect(r.completedFields).toBe(1);
    expect(r.totalFields).toBe(2);
    expect(r.completionPercentage).toBe(50);
    expect(r.isComplete).toBe(false);
  });

  it("cardinality='many': empty model instances still count in the denominator (#55)", () => {
    const entityTypes = [et('models', [field('f1', true)])];
    const instanceIds = new Map([['models', new Set(['m1', 'm2'])]]); // 2 instances exist
    const r = computeRequiredFieldProgress({ m1_f1: 'filled' }, entityTypes, instanceIds);
    expect(r.totalFields).toBe(2); // 1 required × 2 instances
    expect(r.completedFields).toBe(1);
    expect(r.completionPercentage).toBe(50); // NOT 100
  });

  it('phantom instance: required fields with zero observed instances → denominator 1, never NaN', () => {
    const r = computeRequiredFieldProgress({}, [et('e1', [field('f1', true), field('f2', true)])]);
    expect(r.totalFields).toBe(2); // 2 required × 1 phantom instance
    expect(r.completionPercentage).toBe(0);
    expect(Number.isFinite(r.completionPercentage)).toBe(true);
  });

  it('empty string / null / undefined are not counted as filled', () => {
    const entityTypes = [et('e1', [field('f1', true), field('f2', true), field('f3', true)])];
    const r = computeRequiredFieldProgress(
      { i1_f1: '', i1_f2: null, i1_f3: undefined },
      entityTypes,
    );
    expect(r.completedFields).toBe(0);
  });

  it('optional fields are ignored in numerator and denominator', () => {
    const entityTypes = [et('e1', [field('req', true), field('opt', false)])];
    const r = computeRequiredFieldProgress({ i1_req: 'x', i1_opt: 'y' }, entityTypes);
    expect(r.totalFields).toBe(1);
    expect(r.completedFields).toBe(1);
    expect(r.completionPercentage).toBe(100);
    expect(r.isComplete).toBe(true);
  });

  it('no required fields → 0% and not complete (QA-style template)', () => {
    const entityTypes = [et('e1', [field('f1', false), field('f2', false)])];
    const r = computeRequiredFieldProgress({ i1_f1: 'x' }, entityTypes);
    expect(r.totalFields).toBe(0);
    expect(r.completionPercentage).toBe(0);
    expect(r.isComplete).toBe(false);
  });

  it('all required pairs filled → 100% and complete', () => {
    const entityTypes = [et('e1', [field('f1', true), field('f2', true)])];
    const r = computeRequiredFieldProgress({ i1_f1: 'a', i1_f2: 'b' }, entityTypes);
    expect(r.completionPercentage).toBe(100);
    expect(r.isComplete).toBe(true);
  });

  it('derives instance count from value keys when no explicit set is passed (header path)', () => {
    const entityTypes = [et('models', [field('f1', true)])];
    const r = computeRequiredFieldProgress({ m1_f1: 'x', m2_f1: 'y' }, entityTypes);
    expect(r.totalFields).toBe(2);
    expect(r.completedFields).toBe(2);
    expect(r.completionPercentage).toBe(100);
  });
});

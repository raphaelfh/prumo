import { describe, expect, it } from 'vitest';

import type { ExtractionField } from '@/types/extraction';

import {
  computeRequiredFieldProgress,
  computeRowProgress,
  type ProgressEntityProjection,
} from './progress';

function field(id: string, is_required: boolean): ExtractionField {
  // Only id + is_required are read by the formula.
  return { id, is_required } as ExtractionField;
}

function et(
  id: string,
  fields: ExtractionField[],
  is_required = false,
): ProgressEntityProjection {
  return { id, fields, is_required };
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

  it('authoritative set + template marks the entity REQUIRED: zero instances keeps a phantom slot (form stays below 100% until one is added)', () => {
    const entityTypes = [
      et('study', [field('s1', true)]), // materialized singleton, filled
      // A required cardinality='many' entity with no instances added: the
      // template demands at least one, so it must keep the form incomplete.
      et('required_models', [field('m1', true), field('m2', true)], true),
    ];
    const instanceIds = new Map([['study', new Set(['study-inst'])]]);
    const r = computeRequiredFieldProgress(
      { 'study-inst_s1': 'a' },
      entityTypes,
      instanceIds,
    );
    // denom = 1 (study) + 2 (required_models phantom) = 3; filled = 1.
    expect(r.totalFields).toBe(3);
    expect(r.completedFields).toBe(1);
    expect(r.isComplete).toBe(false);
  });

  it('authoritative set: an entity type with zero instances contributes nothing — an optional cardinality=many entity (and its child sections) with no instances does not block 100%', () => {
    const entityTypes = [
      et('study', [field('s1', true), field('s2', true)]), // materialized singleton
      et('prediction_models', [field('m1', true), field('m2', true)]), // optional many, no models added
      et('model_performance', [field('p1', true)]), // child of models, no instances
    ];
    // Only the study singleton is materialized; both its required fields filled.
    const instanceIds = new Map([['study', new Set(['study-inst'])]]);
    const r = computeRequiredFieldProgress(
      { 'study-inst_s1': 'a', 'study-inst_s2': 'b' },
      entityTypes,
      instanceIds,
    );
    // denom = 2 (study only); the absent model entities add no phantom slots.
    expect(r.totalFields).toBe(2);
    expect(r.completedFields).toBe(2);
    expect(r.completionPercentage).toBe(100);
    expect(r.isComplete).toBe(true);
  });
});

describe('computeRowProgress (article/row level — shared by both list tables)', () => {
  const entityTypes = [et('e1', [field('f1', true), field('f2', true), field('opt', false)])];
  const inst = (id: string, entityTypeId: string, status?: string) => ({
    id,
    entity_type_id: entityTypeId,
    status,
  });
  const val = (instance_id: string, field_id: string, value: unknown) => ({
    instance_id,
    field_id,
    value,
  });

  it('agrees with the canonical header metric for the same data (the bug regression)', () => {
    const rowPct = computeRowProgress(
      [inst('i1', 'e1')],
      [val('i1', 'f1', { value: 'x' })],
      entityTypes,
    );
    const headerPct = computeRequiredFieldProgress({ i1_f1: 'x' }, entityTypes).completionPercentage;
    expect(rowPct).toBe(50);
    expect(rowPct).toBe(headerPct); // same article => same % in list and header
  });

  it("cardinality='many': 2 instances, only one filled => 50% (not 100)", () => {
    const ets = [et('e1', [field('f1', true), field('f2', true)])];
    const pct = computeRowProgress(
      [inst('m1', 'e1'), inst('m2', 'e1')],
      [val('m1', 'f1', { value: 'a' }), val('m1', 'f2', { value: 'b' })],
      ets,
    );
    expect(pct).toBe(50); // denom = 2 required × 2 instances = 4; filled = 2
  });

  it('all instances completed => 100% (terminal shortcut)', () => {
    expect(computeRowProgress([inst('i1', 'e1', 'completed')], [], entityTypes)).toBe(100);
  });

  it('rows without status never trigger the completed shortcut', () => {
    expect(computeRowProgress([inst('i1', 'e1')], [], entityTypes)).toBe(0);
  });

  it('QA fallback (no required fields) => instance-based, not a 0% flatline', () => {
    const ets = [et('e1', [field('f1', false)])];
    expect(
      computeRowProgress(
        [inst('i1', 'e1'), inst('i2', 'e1')],
        [val('i1', 'f1', { value: 'x' })],
        ets,
      ),
    ).toBe(50);
  });

  it('empty wrapped value {value:""} is not counted as filled', () => {
    expect(
      computeRowProgress([inst('i1', 'e1')], [val('i1', 'f1', { value: '' })], entityTypes),
    ).toBe(0);
  });

  it('no instances => 0%', () => {
    expect(computeRowProgress([], [], entityTypes)).toBe(0);
  });

  it('no-model article: optional model entities with no instances do not block 100% (the 40% bug)', () => {
    const ets = [
      et('participants', [field('a', true), field('b', true)]),
      et('prediction_models', [field('m1', true), field('m2', true)]), // optional many, none added
      et('model_performance', [field('p1', true)]), // child section, no instances
    ];
    const pct = computeRowProgress(
      [inst('p-inst', 'participants')], // only the singleton is materialized
      [val('p-inst', 'a', { value: 'x' }), val('p-inst', 'b', { value: 'y' })],
      ets,
    );
    // Every materialized required field is filled and no models exist, so the
    // article is complete — the unadded model sections must not drag this to 40%.
    expect(pct).toBe(100);
  });
});

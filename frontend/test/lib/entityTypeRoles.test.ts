/**
 * Unit tests for ``partitionEntityTypes`` — the single source of truth
 * for "study-level vs model container vs model section" partitioning.
 *
 * Locks the contract so any future refactor of the role discriminant
 * (e.g. swapping the column name, adding a fourth role) surfaces here
 * instead of in a downstream rendering bug.
 */
import {renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {
  ENTITY_ROLE,
  isModelContainer,
  isModelSection,
  isStudySection,
  partitionEntityTypes,
  useEntityTypePartition,
} from '@/lib/extraction/entityTypeRoles';

type Row = {id: string; role: typeof ENTITY_ROLE[keyof typeof ENTITY_ROLE]};

function row(id: string, role: Row['role']): Row {
  return {id, role};
}

describe('entity role predicates', () => {
  it('classify rows by their role column, not by name', () => {
    const study = row('a', ENTITY_ROLE.STUDY_SECTION);
    const container = row('b', ENTITY_ROLE.MODEL_CONTAINER);
    const child = row('c', ENTITY_ROLE.MODEL_SECTION);

    expect(isStudySection(study)).toBe(true);
    expect(isStudySection(container)).toBe(false);
    expect(isStudySection(child)).toBe(false);

    expect(isModelContainer(container)).toBe(true);
    expect(isModelContainer(study)).toBe(false);
    expect(isModelContainer(child)).toBe(false);

    expect(isModelSection(child)).toBe(true);
    expect(isModelSection(study)).toBe(false);
    expect(isModelSection(container)).toBe(false);
  });
});

describe('partitionEntityTypes', () => {
  it('returns empty partitions for an empty input', () => {
    const partition = partitionEntityTypes<Row>([]);
    expect(partition.studyLevel).toEqual([]);
    expect(partition.modelContainer).toBeUndefined();
    expect(partition.modelChildren).toEqual([]);
  });

  it('groups every study_section into studyLevel and leaves the model fields empty', () => {
    const rows = [
      row('a', ENTITY_ROLE.STUDY_SECTION),
      row('b', ENTITY_ROLE.STUDY_SECTION),
    ];
    const partition = partitionEntityTypes(rows);
    expect(partition.studyLevel).toEqual(rows);
    expect(partition.modelContainer).toBeUndefined();
    expect(partition.modelChildren).toEqual([]);
  });

  it('keeps the model container even when it has no children', () => {
    const rows = [
      row('study', ENTITY_ROLE.STUDY_SECTION),
      row('container', ENTITY_ROLE.MODEL_CONTAINER),
    ];
    const partition = partitionEntityTypes(rows);
    expect(partition.studyLevel.map(r => r.id)).toEqual(['study']);
    expect(partition.modelContainer?.id).toBe('container');
    expect(partition.modelChildren).toEqual([]);
  });

  it('returns a CHARMS-like split: study + container + children', () => {
    const rows: Row[] = [
      row('source_of_data', ENTITY_ROLE.STUDY_SECTION),
      row('participants', ENTITY_ROLE.STUDY_SECTION),
      row('prediction_models', ENTITY_ROLE.MODEL_CONTAINER),
      row('model_development', ENTITY_ROLE.MODEL_SECTION),
      row('model_performance', ENTITY_ROLE.MODEL_SECTION),
      row('observations', ENTITY_ROLE.STUDY_SECTION),
    ];
    const partition = partitionEntityTypes(rows);

    // study_level preserves input order, including observations after
    // the container in the original list.
    expect(partition.studyLevel.map(r => r.id)).toEqual([
      'source_of_data',
      'participants',
      'observations',
    ]);
    expect(partition.modelContainer?.id).toBe('prediction_models');
    expect(partition.modelChildren.map(r => r.id)).toEqual([
      'model_development',
      'model_performance',
    ]);
  });

  it('preserves input order within each partition', () => {
    // sort_order is deliberately scrambled to confirm the helper does
    // NOT re-sort — callers feed pre-ordered data and expect that
    // order to flow through.
    const rows: Row[] = [
      row('c', ENTITY_ROLE.MODEL_SECTION),
      row('a', ENTITY_ROLE.MODEL_SECTION),
      row('b', ENTITY_ROLE.MODEL_SECTION),
    ];
    const partition = partitionEntityTypes([
      ...rows,
      row('container', ENTITY_ROLE.MODEL_CONTAINER),
    ]);
    expect(partition.modelChildren.map(r => r.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('useEntityTypePartition', () => {
  it('returns the same partition object across renders when input is stable', () => {
    const entityTypes: Row[] = [
      row('study', ENTITY_ROLE.STUDY_SECTION),
      row('container', ENTITY_ROLE.MODEL_CONTAINER),
    ];
    const {result, rerender} = renderHook(
      ({ets}: {ets: Row[]}) => useEntityTypePartition(ets),
      {initialProps: {ets: entityTypes}},
    );
    const first = result.current;
    rerender({ets: entityTypes});
    expect(result.current).toBe(first);
  });

  it('recomputes when the input array changes', () => {
    const a: Row[] = [row('s', ENTITY_ROLE.STUDY_SECTION)];
    const b: Row[] = [
      row('s', ENTITY_ROLE.STUDY_SECTION),
      row('c', ENTITY_ROLE.MODEL_CONTAINER),
    ];
    const {result, rerender} = renderHook(
      ({ets}: {ets: Row[]}) => useEntityTypePartition(ets),
      {initialProps: {ets: a}},
    );
    const first = result.current;
    rerender({ets: b});
    expect(result.current).not.toBe(first);
    expect(result.current.modelContainer?.id).toBe('c');
  });
});

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useQASectionNav } from '../useQASectionNav';
import type { QADomain } from '@/types/qa';

function domain(id: string, label: string, requiredFieldIds: string[]): QADomain {
  return {
    entityType: { id, name: `${id}_name`, label, is_required: true },
    fields: requiredFieldIds.map((fieldId) => ({ id: fieldId, entity_type_id: id, is_required: true })),
  } as unknown as QADomain;
}

const IN_SCOPE = new Set<string>();

describe('useQASectionNav', () => {
  it('lists only the domains with a session instance, counting their own required fields', () => {
    const domains = [domain('d1', 'Participants', ['f1', 'f2']), domain('d2', 'Outcome', ['f3'])];
    const { result } = renderHook(() => useQASectionNav(domains, { d1: 'i1' }, { i1_f1: 'Yes' }, IN_SCOPE));

    expect(result.current.renderedDomains.map((r) => r.instanceId)).toEqual(['i1']);
    expect(result.current.items).toEqual([
      expect.objectContaining({ id: 'd1', label: 'Participants', requiredFilled: 1, requiredTotal: 2 }),
    ]);
  });

  it('falls back to the domain name when it has no label', () => {
    const { result } = renderHook(() => useQASectionNav([domain('d1', '', ['f1'])], { d1: 'i1' }, {}, IN_SCOPE));
    expect(result.current.items[0].label).toBe('d1_name');
  });

  it('keeps an out-of-scope domain on the rail but owes nothing in it, answered or not', () => {
    // The worklist's rule (scopedRowProgress): the section leaves BOTH sides of
    // the count, so a value left in it is not progress either.
    const domains = [domain('d1', 'Development', ['f1']), domain('d2', 'Evaluation', ['f2'])];
    const { result } = renderHook(() =>
      useQASectionNav(domains, { d1: 'i1', d2: 'i2' }, { i2_f2: 'High' }, new Set(['d2_name'])),
    );

    expect(result.current.items).toEqual([
      expect.objectContaining({ id: 'd1', requiredFilled: 0, requiredTotal: 1 }),
      expect.objectContaining({ id: 'd2', requiredFilled: 0, requiredTotal: 0 }),
    ]);
    // The form renders these same domains, so none of its rows can stay pending
    // (a jump target) while the entry reads 0/0.
    expect(result.current.renderedDomains[1].domain.fields[0].is_required).toBe(false);
    // Scoped by copy: the compare and consensus views read the template's own domains.
    expect(domains[1].fields[0].is_required).toBe(true);
  });
});

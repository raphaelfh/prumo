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

describe('useQASectionNav', () => {
  it('lists only the domains with a session instance, counting their own required fields', () => {
    const domains = [domain('d1', 'Participants', ['f1', 'f2']), domain('d2', 'Outcome', ['f3'])];
    const { result } = renderHook(() => useQASectionNav(domains, { d1: 'i1' }, { i1_f1: 'Yes' }));

    expect(result.current.renderedDomains.map((r) => r.instanceId)).toEqual(['i1']);
    expect(result.current.items).toEqual([
      expect.objectContaining({ id: 'd1', label: 'Participants', requiredFilled: 1, requiredTotal: 2 }),
    ]);
  });

  it('falls back to the domain name when it has no label', () => {
    const { result } = renderHook(() => useQASectionNav([domain('d1', '', ['f1'])], { d1: 'i1' }, {}));
    expect(result.current.items[0].label).toBe('d1_name');
  });
});

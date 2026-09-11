import { describe, expect, it } from 'vitest';
import { firstPendingInstanceId } from '@/lib/runs/suggestionLocate';
import type { AISuggestion } from '@/types/ai-extraction';

const sug = (status: AISuggestion['status']): AISuggestion => ({ status }) as AISuggestion;

describe('firstPendingInstanceId', () => {
  it('returns the instance id of the first pending suggestion', () => {
    expect(
      firstPendingInstanceId({ 'inst-1_field-9': sug('accepted'), 'inst-2_field-3': sug('pending') }),
    ).toBe('inst-2');
  });
  it('returns null when nothing is pending', () => {
    expect(firstPendingInstanceId({ a_b: sug('rejected') })).toBeNull();
  });
  it('returns null on an empty map', () => {
    expect(firstPendingInstanceId({})).toBeNull();
  });
});

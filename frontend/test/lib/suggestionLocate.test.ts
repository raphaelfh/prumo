import { describe, expect, it, vi } from 'vitest';
import { firstPendingInstanceId, scrollToSectionById } from '@/lib/runs/suggestionLocate';
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

describe('scrollToSectionById', () => {
  it('scrolls the matching section and reports success', () => {
    const el = document.createElement('div');
    el.setAttribute('data-section-id', 'et-1');
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    expect(scrollToSectionById('et-1')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
    el.remove();
  });
  it('returns false when the section is not mounted', () => {
    expect(scrollToSectionById('missing')).toBe(false);
  });
});

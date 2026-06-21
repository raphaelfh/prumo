import { describe, expect, it } from 'vitest';
import { nextArticleTarget } from '@/lib/extraction/worklistNav';

const arts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('nextArticleTarget', () => {
  it('returns the next article in order', () => {
    expect(nextArticleTarget(arts, 'a')).toBe('b');
    expect(nextArticleTarget(arts, 'b')).toBe('c');
  });
  it('returns null at the end of the queue', () => {
    expect(nextArticleTarget(arts, 'c')).toBeNull();
  });
  it('returns null when current is unknown or list is short', () => {
    expect(nextArticleTarget(arts, 'zz')).toBeNull();
    expect(nextArticleTarget([{ id: 'only' }], 'only')).toBeNull();
  });
});

import {describe, expect, it} from 'vitest';
import {findBlockByIndex} from '../readerLocate';

const blocks = [
  {id: 'a', pageNumber: 1, blockIndex: 0, text: 'Intro'},
  {id: 'b', pageNumber: 1, blockIndex: 1, text: 'We enrolled 100 patients.'},
  {id: 'c', pageNumber: 2, blockIndex: 0, text: 'Methods'},
];

describe('findBlockByIndex', () => {
  it('returns the id of the first matching (page, blockIndex)', () => {
    expect(findBlockByIndex(blocks, 1, [1])).toBe('b');
  });
  it('returns null when nothing matches', () => {
    expect(findBlockByIndex(blocks, 1, [9])).toBeNull();
  });
  it('returns null on empty blockIds', () => {
    expect(findBlockByIndex(blocks, 1, [])).toBeNull();
  });
});

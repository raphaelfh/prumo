import {describe, expect, it} from 'vitest';
import {displayedSize, effectiveRotation} from '../core/rotation';

describe('effectiveRotation', () => {
  it('adds the view rotation to the page’s own /Rotate, wrapping at 360', () => {
    expect(effectiveRotation({rotation: 0}, 0)).toBe(0);
    expect(effectiveRotation({rotation: 90}, 0)).toBe(90);
    expect(effectiveRotation({rotation: 90}, 90)).toBe(180);
    expect(effectiveRotation({rotation: 270}, 180)).toBe(90);
  });
});

describe('displayedSize', () => {
  it('scales the size by zoom', () => {
    expect(displayedSize({width: 612, height: 792}, 0, 1.5)).toEqual({width: 918, height: 1188});
  });

  it('swaps width and height for a quarter view rotation only', () => {
    expect(displayedSize({width: 612, height: 792}, 90, 1)).toEqual({width: 792, height: 612});
    expect(displayedSize({width: 612, height: 792}, 180, 1)).toEqual({width: 612, height: 792});
    expect(displayedSize({width: 612, height: 792}, 270, 2)).toEqual({width: 1584, height: 1224});
  });
});

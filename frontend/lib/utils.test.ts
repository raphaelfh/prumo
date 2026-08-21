import {describe, expect, it} from 'vitest';
import {cn} from './utils';

describe('cn — custom shadow classGroup', () => {
  // Each `shadow-elev-*` token must be registered in the twMerge classGroup,
  // otherwise a consumer overriding a primitive's built-in `shadow-*` gets
  // BOTH rules emitted and stylesheet order decides the winner.
  it.each([
    ['shadow-elev-card'],
    ['shadow-elev-popover'],
    ['shadow-elev-header'],
  ])('%s overrides a built-in shadow instead of stacking', (token) => {
    expect(cn('shadow-sm', token)).toBe(token);
  });

  it.each([
    ['shadow-elev-card'],
    ['shadow-elev-popover'],
    ['shadow-elev-header'],
  ])('a later built-in shadow overrides %s', (token) => {
    expect(cn(token, 'shadow-md')).toBe('shadow-md');
  });

  it('still merges ordinary conflicting utilities', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

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

describe('cn — custom z-index classGroup', () => {
  // `z-header` is a project `@utility` (frontend/index.css), so tailwind-merge
  // cannot infer that it belongs to the built-in `z-*` group. Unregistered, a
  // consumer overriding HeaderShell's z-index gets BOTH classes emitted and
  // stylesheet order — not call order — decides the winner.
  it('a later built-in z-index overrides z-header', () => {
    expect(cn('z-header', 'z-50')).toBe('z-50');
  });

  it('z-header overrides an earlier built-in z-index', () => {
    expect(cn('z-50', 'z-header')).toBe('z-header');
  });

  it('leaves a lone z-header and its non-conflicting neighbours alone', () => {
    expect(cn('sticky top-0 z-header')).toBe('sticky top-0 z-header');
  });

  it('still merges built-in z-index against itself', () => {
    expect(cn('z-10', 'z-50')).toBe('z-50');
  });
});

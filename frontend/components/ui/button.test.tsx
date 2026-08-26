/**
 * Characterization tests for the button size scale.
 *
 * These pin what the scale renders TODAY. The scale is mid-migration to the
 * `frontend-ux` chrome density (h-7), so when those heights change these
 * assertions change with them — which is the point: a height change becomes a
 * readable test diff instead of an invisible class edit.
 *
 * Assertions read the RENDERED className, not `buttonVariants()`'s raw output.
 * The raw cva string can contain two classes that conflict (e.g. a base
 * `[&_svg]:size-4` and a per-size `[&_svg]:size-3.5`); only `cn()` picks the
 * winner, so asserting on the raw string would pass whether or not the class
 * ever applies.
 */

import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Button} from './button';

const classesOf = (name: string): string[] =>
  screen.getByRole('button', {name}).className.split(/\s+/).filter(Boolean);

/** The height utility actually in effect — `h-*`, ignoring min-/max-/variants. */
const heightOf = (name: string): string | undefined =>
  classesOf(name).find((c) => /^h-\d/.test(c));

describe('button size scale', () => {
  it.each([
    ['default', 'h-10'],
    ['sm', 'h-9'],
    ['lg', 'h-11'],
    ['icon', 'h-10'],
    ['header', 'h-8'],
  ] as const)('size=%s renders %s', (size, expected) => {
    render(<Button size={size}>Go</Button>);
    expect(heightOf('Go')).toBe(expected);
  });

  it('icon sizes are square', () => {
    render(<Button size="icon">Go</Button>);
    const cls = classesOf('Go');
    expect(cls).toContain('h-10');
    expect(cls).toContain('w-10');
  });

  it('the header sizes carry a coarse-pointer touch bump', () => {
    render(<Button size="header">Go</Button>);
    expect(classesOf('Go')).toContain('[@media(pointer:coarse)]:h-11');
  });

  it('the non-header sizes do NOT yet carry one', () => {
    // Documents the gap the scale migration closes: 3 coarse-pointer
    // declarations exist in the whole frontend, so most buttons are under the
    // 44px touch minimum.
    render(<Button size="sm">Go</Button>);
    expect(classesOf('Go')).not.toContain('[@media(pointer:coarse)]:h-11');
  });

  it('a call-site height override wins over the scale', () => {
    // Why the ratchet exists: 151 call sites currently do this.
    render(<Button size="sm" className="h-7">Go</Button>);
    expect(heightOf('Go')).toBe('h-7');
  });
});

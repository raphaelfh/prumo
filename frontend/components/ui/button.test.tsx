/**
 * Characterization tests for the button size scale.
 *
 * These pin what the scale renders. Assertions read the RENDERED className,
 * not `buttonVariants()`'s raw output: the raw cva string can contain two
 * classes that conflict (a base `[&_svg]:size-4` and a per-size
 * `[&_svg]:size-3.5`), and only `cn()` picks the winner — so a raw-string
 * assertion would pass whether or not the class ever applies.
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
    ['sm', 'h-7'],
    ['xs', 'h-6'],
    ['lg', 'h-11'],
    ['icon', 'h-7'],
    ['icon-xs', 'h-6'],
  ] as const)('size=%s renders %s', (size, expected) => {
    render(<Button size={size}>Go</Button>);
    expect(heightOf('Go')).toBe(expected);
  });

  it.each([
    ['icon', 'h-7', 'w-7'],
    ['icon-xs', 'h-6', 'w-6'],
  ] as const)('size=%s is square', (size, h, w) => {
    render(<Button size={size}>Go</Button>);
    const cls = classesOf('Go');
    expect(cls).toContain(h);
    expect(cls).toContain(w);
  });

  it.each(['sm', 'xs', 'icon', 'icon-xs'] as const)(
    'size=%s meets the 44px touch target on a coarse pointer',
    (size) => {
      render(<Button size={size}>Go</Button>);
      expect(classesOf('Go')).toContain('[@media(pointer:coarse)]:h-11');
    },
  );

  it.each(['icon', 'icon-xs'] as const)(
    'size=%s bumps width too, so a coarse target is not a tall thin sliver',
    (size) => {
      render(<Button size={size}>Go</Button>);
      expect(classesOf('Go')).toContain('[@media(pointer:coarse)]:w-11');
    },
  );

  it.each([
    ['default', 'text-sm'],
    ['sm', 'text-[13px]'],
    ['xs', 'text-xs'],
    ['lg', 'text-sm'],
    ['icon', 'text-[13px]'],
    ['icon-xs', 'text-xs'],
  ] as const)('size=%s carries an explicit %s', (size, expected) => {
    // Text size moved out of the cva base into each size. Every size must
    // name one — `icon` renders literal glyph children in places
    // (AllowedUnitsList's arrows), so "inherits ambient" is not acceptable.
    render(<Button size={size}>Go</Button>);
    expect(classesOf('Go')).toContain(expected);
  });

  it.each(['xs', 'icon-xs'] as const)('size=%s shrinks its icon slot', (size) => {
    render(<Button size={size}>Go</Button>);
    const cls = classesOf('Go');
    expect(cls).toContain('[&_svg]:size-3.5');
    expect(cls).not.toContain('[&_svg]:size-4');
  });

  it('a call-site height override still wins — which is why the ratchet exists', () => {
    render(<Button size="sm" className="h-9">Go</Button>);
    expect(heightOf('Go')).toBe('h-9');
  });

  it('a Button with NO size prop renders the compact chrome tier', () => {
    // The system standard, not a per-call-site opt-in: omitting `size` used
    // to render the 40px CTA, which is how dialog footers ended up 40px tall
    // beside 28px content. A CTA now opts in with size="default".
    render(<Button>Go</Button>);
    expect(heightOf('Go')).toBe('h-7');
    expect(classesOf('Go')).toContain('[@media(pointer:coarse)]:h-11');
  });
});

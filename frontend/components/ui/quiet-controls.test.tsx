/**
 * Guard for the `quiet` variant — a deliberate divergence from upstream shadcn
 * (ui-styling skill; spec 2026-09-13-borderless-density-pass-design.md §4.2).
 * jsdom compiles no CSS, so this pins the class contract. The default strings
 * are today's output byte-for-byte: out-of-scope screens must not move.
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Input} from './input';
import {Select, SelectTrigger, SelectValue} from './select';
import {Textarea} from './textarea';

const INPUT_DEFAULT =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm';
const TEXTAREA_DEFAULT =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 resize-y';
const TRIGGER_DEFAULT =
  'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 [&>span]:line-clamp-1';

const QUIET = [
  'border-transparent', 'bg-transparent', 'shadow-none', 'px-2', 'text-[13px]', 'md:text-[13px]',
  'hover:bg-muted/60', 'disabled:hover:bg-transparent',
  'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:bg-background',
  'aria-[invalid=true]:ring-1', 'aria-[invalid=true]:ring-destructive', 'aria-[invalid=true]:focus-visible:ring-2',
];
const GONE = ['border-input', 'bg-background', 'px-3'];
const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);
const renderTrigger = (variant?: 'default' | 'quiet') =>
  render(<Select><SelectTrigger variant={variant} aria-label="Mode"><SelectValue /></SelectTrigger></Select>);

describe('default variant keeps upstream classes', () => {
  it('Input', () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByRole('textbox').className).toBe(INPUT_DEFAULT);
  });
  it('Input with variant="default"', () => {
    render(<Input variant="default" aria-label="Name" />);
    expect(screen.getByRole('textbox').className).toBe(INPUT_DEFAULT);
  });
  it('Textarea', () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole('textbox').className).toBe(TEXTAREA_DEFAULT);
  });
  it('SelectTrigger', () => {
    renderTrigger();
    expect(screen.getByRole('combobox').className).toBe(TRIGGER_DEFAULT);
  });
});

describe('quiet variant', () => {
  it('Input: borderless, hover fill, 13px at every width, focus-visible ring and fill, invalid ring', () => {
    render(<Input variant="quiet" aria-label="Name" />);
    const classes = classesOf(screen.getByRole('textbox'));
    expect(classes).toEqual(expect.arrayContaining([...QUIET, 'h-8']));
    for (const gone of [...GONE, 'h-10', 'text-base', 'md:text-sm']) expect(classes).not.toContain(gone);
  });

  it('Textarea: same contract, keeps its min-h and takes no fixed height', () => {
    render(<Textarea variant="quiet" aria-label="Notes" />);
    const classes = classesOf(screen.getByRole('textbox'));
    expect(classes).toEqual(expect.arrayContaining([...QUIET, 'min-h-[80px]']));
    for (const gone of [...GONE, 'h-8', 'text-sm']) expect(classes).not.toContain(gone);
  });

  it('SelectTrigger: rings on focus-visible only, never focus:, and keeps its chevron', () => {
    renderTrigger('quiet');
    const trigger = screen.getByRole('combobox');
    const classes = classesOf(trigger);
    expect(classes).toEqual(expect.arrayContaining([...QUIET, 'h-8']));
    for (const gone of [...GONE, 'h-10', 'text-sm']) expect(classes).not.toContain(gone);
    expect(classes.filter((c) => c.startsWith('focus:'))).toEqual([]);
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('a caller width class still merges', () => {
    render(<Input variant="quiet" className="w-40" aria-label="Name" />);
    expect(screen.getByRole('textbox')).toHaveClass('w-40');
    expect(screen.getByRole('textbox')).not.toHaveClass('w-full');
  });
});

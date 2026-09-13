import type {ReactElement} from 'react';
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog';

function open(content: ReactElement) {
  render(<Dialog open>{content}</Dialog>);
  return screen.getByRole('dialog');
}

const classesOf = (el: Element) => el.className.split(/\s+/);

describe('DialogContent frame', () => {
  it.each([
    [undefined, 'sm:max-w-[560px]', 'sm:max-h-[85dvh]'],
    ['sm', 'sm:max-w-[400px]', 'sm:max-h-[85dvh]'],
    ['md', 'sm:max-w-[560px]', 'sm:max-h-[85dvh]'],
    ['lg', 'sm:max-w-[800px]', 'sm:h-[85dvh]'],
  ] as const)('size=%s is %s wide and %s tall', (size, width, height) => {
    const dialog = open(
      <DialogContent size={size}>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(classesOf(dialog)).toEqual(expect.arrayContaining([width, height]));
  });

  it('is a bottom sheet below sm and honours reduced motion', () => {
    const dialog = open(
      <DialogContent>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(classesOf(dialog)).toEqual(
      expect.arrayContaining(['bottom-0', 'rounded-t-xl', 'max-sm:data-[state=open]:slide-in-from-bottom', 'motion-reduce:animate-none', 'p-0']),
    );
    expect(classesOf(dialog).some((c) => c.startsWith('translate-') || c.startsWith('-translate-'))).toBe(false);
  });

  it('owns padding in header, body and footer, and the body scrolls', () => {
    open(
      <DialogContent>
        <DialogHeader data-testid="h"><DialogTitle>T</DialogTitle><DialogDescription>D</DialogDescription></DialogHeader>
        <DialogBody data-testid="b">body</DialogBody>
        <DialogFooter data-testid="f">footer</DialogFooter>
      </DialogContent>,
    );
    expect(classesOf(screen.getByTestId('h'))).toEqual(expect.arrayContaining(['px-5', 'pt-5']));
    expect(classesOf(screen.getByTestId('b'))).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto', 'px-5']));
    expect(classesOf(screen.getByTestId('f'))).toEqual(expect.arrayContaining(['px-5', 'pb-5', 'sm:justify-end']));
  });

  it('gives the body last-of-type:pb-5 when there is no footer, and still renders the close button', () => {
    const dialog = open(
      <DialogContent>
        <DialogHeader data-testid="h"><DialogTitle>T</DialogTitle><DialogDescription>D</DialogDescription></DialogHeader>
        <DialogBody data-testid="b">body</DialogBody>
      </DialogContent>,
    );
    expect(classesOf(screen.getByTestId('b'))).toEqual(expect.arrayContaining(['last-of-type:pb-5']));
    expect(screen.getByRole('button', {name: 'Close'})).toBeInTheDocument();
    expect(dialog).toContainElement(screen.getByRole('button', {name: 'Close'}));
  });

  it('has a named close button that can be turned off', () => {
    const {unmount} = render(
      <Dialog open>
        <DialogContent><DialogTitle>T</DialogTitle><DialogDescription>D</DialogDescription></DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('button', {name: 'Close'})).toBeInTheDocument();
    unmount();
    open(
      <DialogContent showCloseButton={false}>
        <DialogTitle>T</DialogTitle>
        <DialogDescription>D</DialogDescription>
      </DialogContent>,
    );
    expect(screen.queryByRole('button', {name: 'Close'})).toBeNull();
  });
});

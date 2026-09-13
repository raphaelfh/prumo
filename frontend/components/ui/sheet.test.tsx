import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Sheet, SheetContent, SheetDescription, SheetTitle} from './sheet';

function openSheet(props: {side?: 'left' | 'right'; size?: 'default' | 'narrow'}) {
  render(
    <Sheet open>
      <SheetContent {...props}>
        <SheetTitle>T</SheetTitle>
        <SheetDescription>D</SheetDescription>
      </SheetContent>
    </Sheet>,
  );
  return screen.getByRole('dialog').className.split(/\s+/);
}

describe('SheetContent frame', () => {
  it('defaults to a 420px right sheet with the 200/150 ms motion', () => {
    expect(openSheet({})).toEqual(
      expect.arrayContaining(['w-[420px]', 'right-0', 'data-[state=open]:duration-200', 'data-[state=closed]:duration-150', 'motion-reduce:animate-none']),
    );
  });

  it('has a narrow 320px variant for rails and inspectors', () => {
    expect(openSheet({side: 'left', size: 'narrow'})).toEqual(expect.arrayContaining(['w-[320px]', 'left-0']));
  });

  it('has a named close button', () => {
    openSheet({});
    expect(screen.getByRole('button', {name: 'Close'})).toBeInTheDocument();
  });
});

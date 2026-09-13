import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

function Confirm() {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete article?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe('AlertDialog', () => {
  it('sits on the sm frame', () => {
    render(<Confirm />);
    expect(screen.getByRole('alertdialog').className.split(/\s+/)).toEqual(
      expect.arrayContaining(['sm:max-w-[400px]', 'p-0', 'motion-reduce:animate-none']),
    );
  });

  it('focuses Cancel on open, so Enter never fires the destructive action', () => {
    render(<Confirm />);
    expect(screen.getByRole('button', {name: 'Cancel'})).toHaveFocus();
  });

  it('renders the destructive action at chrome density', () => {
    render(<Confirm />);
    const classes = screen.getByRole('button', {name: 'Delete'}).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-destructive', 'h-7']));
  });
});

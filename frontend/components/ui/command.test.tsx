import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {CommandDialog, CommandInput} from './command';

describe('CommandDialog', () => {
  it('has an accessible name from the required title prop', () => {
    render(
      <CommandDialog open title="Command palette">
        <CommandInput placeholder="Type…" />
      </CommandDialog>,
    );
    expect(screen.getByRole('dialog', {name: 'Command palette'})).toBeInTheDocument();
  });
});

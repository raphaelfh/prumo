import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  RunEditabilityProvider,
  useRunEditability,
} from './RunEditabilityContext';

function Probe() {
  const { readOnly } = useRunEditability();
  return <div data-testid="probe" data-readonly={String(readOnly)} />;
}

describe('RunEditability context', () => {
  it('defaults to editable without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-readonly', 'false');
  });

  it('is editable for the extract stage', () => {
    render(
      <RunEditabilityProvider stage="extract">
        <Probe />
      </RunEditabilityProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveAttribute('data-readonly', 'false');
  });

  it.each([['finalized'], ['consensus'], ['pending'], [null]])(
    'is read-only for stage=%s',
    (stage) => {
      render(
        <RunEditabilityProvider stage={stage as string | null}>
          <Probe />
        </RunEditabilityProvider>,
      );
      expect(screen.getByTestId('probe')).toHaveAttribute('data-readonly', 'true');
    },
  );
});

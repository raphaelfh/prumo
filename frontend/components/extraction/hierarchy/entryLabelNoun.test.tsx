import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {ModelSelector} from './ModelSelector';
import {RemoveModelDialog} from './RemoveModelDialog';

/**
 * B-8 D6 — the run-view noun is DATA (`entry_label` on the container).
 *
 * These tests run against the REAL copy module on purpose: a broken
 * `{{noun}}` interpolation would silently fall back to the template
 * string, and a key-mocked `t` could never catch that. One non-"model"
 * noun threads end-to-end through the prop; the fallback test guards the
 * default.
 */

const selectorBase = {
  models: [{instanceId: 'm1', modelName: 'Sepsis at 48h'}],
  activeModelId: 'm1',
  onSelectModel: vi.fn(),
  onAddModel: vi.fn(),
  onRemoveModel: vi.fn(),
};

describe('run-view noun interpolation (B-8 D6)', () => {
  it('ModelSelector renders a non-"model" noun end-to-end', () => {
    render(
      <ModelSelector
        {...selectorBase}
        entryLabel="scenario"
        title="Clinical scenarios"
      />,
    );
    // Title is the container's LABEL (data), not a pluralized noun.
    expect(screen.getByText('Clinical scenarios')).toBeInTheDocument();
    expect(
      screen.getByText('Select a scenario to extract its data'),
    ).toBeInTheDocument();
    expect(screen.getByText('Active scenario')).toBeInTheDocument();
    expect(screen.getByTitle('Remove active scenario')).toBeInTheDocument();
    expect(screen.getByTitle('Add new scenario manually')).toBeInTheDocument();
  });

  it('ModelSelector falls back to the "entry" noun without the prop', () => {
    render(<ModelSelector {...selectorBase} models={[]} activeModelId={null} />);
    expect(screen.getByText('No entry added yet')).toBeInTheDocument();
  });

  it('RemoveModelDialog interpolates the noun into title and description', () => {
    render(
      <RemoveModelDialog
        open
        modelName="Sepsis at 48h"
        hasExtractedData={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        entryLabel="scenario"
      />,
    );
    expect(
      screen.getByRole('heading', {name: /Remove scenario/}),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You are about to remove the scenario "Sepsis at 48h"/),
    ).toBeInTheDocument();
  });
});

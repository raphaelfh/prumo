/**
 * Class-contract test: the inclusion/exclusion labels must stay at the
 * settings-row type size (13px), matching every other label in the PICOTS
 * editor (spec 2026-09-13 §7 "Type"). jsdom cannot see computed font-size,
 * so this pins the Tailwind class instead — a §7 browser pass caught a
 * `text-xs` (12px) regression here (task 15 report).
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {PICOTSItemEditor} from './PICOTSItemEditor';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

describe('PICOTSItemEditor', () => {
  it('renders the inclusion and exclusion labels at 13px, not text-xs', () => {
    render(
      <PICOTSItemEditor
        label="Population"
        fieldKey="population"
        data={{description: '', inclusion: ['adults'], exclusion: ['children']}}
        descriptionPlaceholder="Describe the population"
        showCriteria
        onUpdate={vi.fn()}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    const inclusionLabel = screen.getByText('picotsInclusionCriteriaLabel');
    const exclusionLabel = screen.getByText('picotsExclusionCriteriaLabel');
    expect(inclusionLabel).toHaveClass('text-[13px]');
    expect(inclusionLabel).not.toHaveClass('text-xs');
    expect(exclusionLabel).toHaveClass('text-[13px]');
    expect(exclusionLabel).not.toHaveClass('text-xs');
  });
});

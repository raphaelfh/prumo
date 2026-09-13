/** Review details as two titled groups of label/value rows (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {ReviewDetailsSection} from '@/components/project/settings/ReviewDetailsSection';

const PROJECT = {
  review_title: '',
  condition_studied: '',
  review_rationale: '',
  search_strategy: '',
  review_context: '',
  review_type: 'interventional' as const,
};

function renderDetails() {
  return render(<ReviewDetailsSection project={PROJECT} onChange={vi.fn()} />);
}

describe('ReviewDetailsSection', () => {
  it('renders exactly the two group titles as <h2>', () => {
    renderDetails();
    expect(screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent])).toEqual([
      ['H2', t('project', 'reviewCardGeneralTitle')],
      ['H2', t('project', 'reviewCardSearchTitle')],
    ]);
  });

  it.each([
    ['reviewTitleLabel', 'reviewTitleHint'],
    ['reviewConditionStudiedLabel', 'reviewConditionStudiedHint'],
    ['reviewContextLabel', 'reviewContextHint'],
    ['reviewRationaleLabel', 'reviewRationaleHint'],
    ['reviewStrategyLabel', 'reviewStrategyHint'],
  ] as const)('row %s is labelled and its hint reaches the control', (labelKey, hintKey) => {
    renderDetails();
    const control = screen.getByRole('textbox', {name: t('project', labelKey)});
    expect(control).toHaveAccessibleDescription(t('project', hintKey));
    expect(control).toHaveClass('border-transparent');
  });

  it('keeps the strategy textarea monospace', () => {
    renderDetails();
    expect(screen.getByRole('textbox', {name: t('project', 'reviewStrategyLabel')})).toHaveClass('font-mono');
  });
});

/** Basic info as one untitled group of label/value rows (spec 2026-09-13 §4.3, §10). */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {t} from '@/lib/copy';
import {REVIEW_TYPES, type ReviewType} from '@/types/project';
import {BasicInfoSection} from '@/components/project/settings/BasicInfoSection';

function renderBasic(review_type: ReviewType) {
  return render(
    <BasicInfoSection project={{name: 'P', description: '', review_type}} onChange={vi.fn()} />,
  );
}

const aboutLabel = (label: string) => t('common', 'fieldHintAria').replace('{{label}}', label);

describe('BasicInfoSection', () => {
  it('renders one untitled group: no section heading and no card titles', () => {
    renderBasic('interventional');
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('no longer renders the PICOTS notice box for a predictive-model review', () => {
    const {container} = renderBasic('predictive_model');
    expect(screen.queryByText('PICOTS framework enabled')).toBeNull();
    expect(container.querySelector('[class~="border-primary/20"]')).toBeNull();
  });

  it("the review-type row hint is the selected type's description", () => {
    const {rerender} = renderBasic('predictive_model');
    const trigger = screen.getByRole('combobox', {name: /Review type/});
    expect(trigger).toHaveAccessibleDescription(REVIEW_TYPES.predictive_model.description);
    expect(screen.getByRole('button', {name: aboutLabel(t('project', 'basicReviewTypeLabel'))})).toBeInTheDocument();

    rerender(
      <BasicInfoSection project={{name: 'P', description: '', review_type: 'diagnostic'}} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox', {name: /Review type/})).toHaveAccessibleDescription(
      REVIEW_TYPES.diagnostic.description,
    );
  });

  it('name and description hints reach their controls; controls are quiet with no caller height', () => {
    renderBasic('interventional');
    const name = screen.getByRole('textbox', {name: /Project name/});
    expect(name).toHaveAccessibleDescription(t('project', 'basicProjectNameHint'));
    expect(name).toHaveClass('border-transparent');
    expect(name).not.toHaveClass('h-9');
    expect(screen.getByRole('textbox', {name: /Description/})).toHaveAccessibleDescription(
      t('project', 'basicDescriptionHint'),
    );
  });
});

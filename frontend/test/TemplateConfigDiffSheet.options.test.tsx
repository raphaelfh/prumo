/**
 * TemplateConfigDiffSheet — one sentence per change variant (D8), split
 * from `TemplateConfigDiffSheet.test.tsx` to stay under the file-size
 * ceiling. Copy is deliberately NOT mocked: the tests pin the real strings.
 */
import {within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/templateService', async () => {
  const {templateServiceMock} = await import('./mocks/templateService');
  return templateServiceMock();
});
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: vi.fn(async () => ({ok: true, data: null})),
  updateTemplateInstruction: vi.fn(),
}));

import {templateConfig} from '@/lib/copy';
import {
  diffOk,
  group,
  renderSheet,
  type RowSeed,
  type Variant,
} from '@/test/helpers/templateDiffSheet';

import {loadTemplateConfigDiff} from './mocks/templateService';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The exhaustiveness map inside the sheet is compile-time; this table
 * proves the RENDER path too. Typed over the generated union, so adding a
 * variant to `schema.d.ts` fails the typecheck here as well as in the
 * component.
 */
const FIELDS_REORDER_COUNT = 3;
const OPTIONS_REORDER_COUNT = 4;

const VARIANT_SENTENCE: Record<Variant, string> = {
  entity_type_added: templateConfig.changeEntityTypeAdded,
  entity_type_fields_reordered:
    templateConfig.changeEntityTypeFieldsReordered.replace(
      '{{n}}',
      String(FIELDS_REORDER_COUNT),
    ),
  entity_type_modified: templateConfig.changeEntityTypeModified,
  entity_type_removed: templateConfig.changeEntityTypeRemoved,
  field_added: templateConfig.changeFieldAdded,
  field_modified: templateConfig.changeFieldModified,
  field_moved: templateConfig.changeFieldMoved,
  field_option_added: templateConfig.changeFieldOptionAdded,
  field_option_removed: templateConfig.changeFieldOptionRemoved,
  field_option_renamed: templateConfig.changeFieldOptionRenamed,
  field_options_reordered: templateConfig.changeFieldOptionsReordered.replace(
    '{{n}}',
    String(OPTIONS_REORDER_COUNT),
  ),
  field_removed: templateConfig.changeFieldRemoved,
  template_instruction_added: templateConfig.changeTemplateInstructionAdded,
  template_instruction_modified:
    templateConfig.changeTemplateInstructionModified,
  template_instruction_removed: templateConfig.changeTemplateInstructionRemoved,
};

/** All 15, every one in the open tier so no disclosure hides a gap. */
const ALL_VARIANTS: RowSeed[] = (
  Object.keys(VARIANT_SENTENCE) as Variant[]
).map((variant) => ({
  id: `row-${variant}`,
  variant,
  tier: 'destructive' as const,
  // The instruction rows carry no label path — exercises that branch too.
  label_path: variant.startsWith('template_instruction')
    ? []
    : ['Section A', 'Field X'],
  reorder_count:
    variant === 'entity_type_fields_reordered'
      ? FIELDS_REORDER_COUNT
      : variant === 'field_options_reordered'
        ? OPTIONS_REORDER_COUNT
        : null,
}));

describe('TemplateConfigDiffSheet — variant copy (D8)', () => {
  it('reaches all 15 generated variants from a rendered row', async () => {
    expect(Object.keys(VARIANT_SENTENCE)).toHaveLength(15);
    loadTemplateConfigDiff.mockResolvedValue(diffOk(ALL_VARIANTS));
    renderSheet();

    const scope = await group('destructive');
    for (const [variant, sentence] of Object.entries(VARIANT_SENTENCE)) {
      const rowEl = within(scope).getByTestId(`template-diff-row-row-${variant}`);
      expect(rowEl).toHaveTextContent(sentence);
    }
  });

  it('gives the two reorder variants different sentences', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(ALL_VARIANTS));
    renderSheet();

    const scope = await group('destructive');
    const fieldsRow = within(scope).getByTestId(
      'template-diff-row-row-entity_type_fields_reordered',
    );
    const optionsRow = within(scope).getByTestId(
      'template-diff-row-row-field_options_reordered',
    );

    expect(fieldsRow.textContent).not.toBe(optionsRow.textContent);
    // The options count INCLUDES options added in the same diff, so the
    // sentence must not imply all N moved.
    expect(optionsRow).not.toHaveTextContent(/options reordered/i);
    // Entity types themselves never reorder — only the fields inside one.
    expect(fieldsRow).not.toHaveTextContent(/sections? reordered/i);
    expect(fieldsRow).toHaveTextContent(String(FIELDS_REORDER_COUNT));
    expect(optionsRow).toHaveTextContent(String(OPTIONS_REORDER_COUNT));
  });

  it('does not claim the fields-reorder count is a count of things that moved', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(ALL_VARIANTS));
    renderSheet();

    // template_diff._diff_field_order ships len(after_seq) — every field
    // that SURVIVED in the section on both sides, not the ones that
    // actually swapped places (backend/app/services/template_diff.py:638-646).
    // A single swap among N survivors still reports N, so the sentence
    // must name the population, never assert that N fields moved.
    const scope = await group('destructive');
    const fieldsRow = within(scope).getByTestId(
      'template-diff-row-row-entity_type_fields_reordered',
    );
    expect(fieldsRow).not.toHaveTextContent(/\d+ fields? (reordered|moved)/i);
    expect(fieldsRow).toHaveTextContent(
      `Order changed among ${FIELDS_REORDER_COUNT} fields`,
    );
  });
});

describe('TemplateConfigDiffSheet — option rename (field_option_renamed)', () => {
  it('names an option rename and shows the old and new label', async () => {
    loadTemplateConfigDiff.mockResolvedValue(
      diffOk([
        {
          id: 'rn1',
          variant: 'field_option_renamed',
          // The backend files a rename as cosmetic: the code is unchanged.
          tier: 'cosmetic',
          attribute: 'allowed_values',
          before: 'Development',
          after: 'Development only',
        },
      ]),
    );
    renderSheet();

    await userEvent.click(within(await group('cosmetic')).getByRole('button'));
    const rowEl = within(await group('cosmetic')).getByTestId(
      'template-diff-row-rn1',
    );
    expect(rowEl).toHaveTextContent('Option renamed');
    expect(rowEl).toHaveTextContent('Development only');
  });
});

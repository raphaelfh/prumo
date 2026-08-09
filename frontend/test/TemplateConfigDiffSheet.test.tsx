/**
 * TemplateConfigDiffSheet — the READ-ONLY "unpublished changes" sheet
 * (slice B-9b2a, D7/D8).
 *
 * A sibling file by design: `TemplateConfigPublish.test.tsx` sits at
 * 698/800 in the file-size ratchet and cannot absorb this.
 *
 * The sheet ratifies the wire model on screen: every tier group expands to
 * the SAME row list (never a count-only group), every one of the 14
 * generated variants reaches a sentence, and the two non-diff shapes get
 * copy that cannot be read as "no changes".
 *
 * Copy is deliberately NOT mocked — D8 is a correctness requirement, so
 * the tests pin the real strings.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState, type ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The factory (spies + both refusal classes) is shared with
// TemplateConfigPublish.test.tsx — see frontend/test/mocks/templateService.ts
// for the hoisting contract behind the async/dynamic-import shape.
vi.mock('@/services/templateService', async () => {
  const {templateServiceMock} = await import('./mocks/templateService');
  return templateServiceMock();
});
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: vi.fn(async () => ({ok: true, data: null})),
  updateTemplateInstruction: vi.fn(),
}));
vi.mock('@/services/extractionFieldService', () => ({
  validateFieldImpact: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(),
}));
vi.mock('@/hooks/extraction/useUpdateTemplateField', () => ({
  useUpdateTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useInsertTemplateField', () => ({
  useInsertTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useMoveTemplateField', () => ({
  useMoveTemplateField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useReorderTemplateFields', () => ({
  useReorderTemplateFields: vi.fn(),
}));
vi.mock('@/hooks/shared/useContainerNarrow', () => ({
  useContainerNarrow: vi.fn(() => false),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));

import {TemplateConfigDiffSheet} from '@/components/extraction/template-config/TemplateConfigDiffSheet';
import {TemplateConfigGridPanel} from '@/components/extraction/template-config/TemplateConfigGridPanel';
import {TemplateConfigPublishControls} from '@/components/extraction/template-config/TemplateConfigPublishControls';
import {TooltipProvider} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useMoveTemplateField} from '@/hooks/extraction/useMoveTemplateField';
import {useReorderTemplateFields} from '@/hooks/extraction/useReorderTemplateFields';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {useContainerNarrow} from '@/hooks/shared/useContainerNarrow';
import {extraction, templateConfig} from '@/lib/copy';
import type {components} from '@/types/api/schema';

import {
  loadTemplateConfigDiff,
  loadTemplateConfigStatus,
} from './mocks/templateService';

type Tier = 'additive' | 'cosmetic' | 'semantic' | 'destructive';
type Variant = components['schemas']['ChangeVariant'];
type OpaqueState = components['schemas']['OpaqueValueState'];

interface RowSeed {
  id: string;
  variant: string;
  tier: Tier;
  label_path?: string[];
  attribute?: string | null;
  before?: string | boolean | null;
  after?: string | boolean | null;
  /** Set INSTEAD of `before`/`after` when the value is opaque (D3). */
  before_opaque_state?: OpaqueState | null;
  after_opaque_state?: OpaqueState | null;
  reorder_count?: number | null;
  affects_recorded_data?: boolean;
}

function row(seed: RowSeed) {
  return {
    label_path: ['Section A', 'Field X'],
    attribute: null,
    before: null,
    after: null,
    before_opaque_state: null,
    after_opaque_state: null,
    reorder_count: null,
    affects_recorded_data: false,
    ...seed,
  };
}

function diffOk(rows: RowSeed[]) {
  const changes: Record<Tier, ReturnType<typeof row>[]> = {
    additive: [],
    cosmetic: [],
    semantic: [],
    destructive: [],
  };
  for (const seed of rows) changes[seed.tier].push(row(seed));
  return {
    ok: true,
    data: {
      project_template_id: 't1',
      status: 'available',
      changes,
    },
  };
}

/** One row per tier, each with a distinguishable label path. */
const ONE_PER_TIER: RowSeed[] = [
  {
    id: 'a1',
    variant: 'field_added',
    tier: 'additive',
    label_path: ['Section A', 'Brand new field'],
  },
  {
    id: 'c1',
    variant: 'entity_type_modified',
    tier: 'cosmetic',
    label_path: ['Renamed section'],
    attribute: 'label',
    before: 'Old name',
    after: 'New name',
  },
  {
    id: 's1',
    variant: 'field_modified',
    tier: 'semantic',
    label_path: ['Section A', 'Newly required field'],
    attribute: 'is_required',
    before: false,
    after: true,
  },
  {
    id: 'd1',
    variant: 'field_removed',
    tier: 'destructive',
    label_path: ['Section A', 'Deleted field'],
  },
];

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <TemplateConfigDiffSheet projectId="p1" templateId="t1" onClose={vi.fn()} />,
    {wrapper},
  );
}

const group = async (tier: Tier) =>
  screen.findByTestId(`template-diff-group-${tier}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateConfigDiffSheet — tier groups expand to rows (D7)', () => {
  it('renders every tier group as a row list, not a count-only summary', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(ONE_PER_TIER));
    renderSheet();

    // Destructive is listed on open — the most consequential tier is never
    // hidden behind a disclosure.
    expect(
      within(await group('destructive')).getByText('Deleted field', {
        exact: false,
      }),
    ).toBeInTheDocument();

    // The other three are expand-to-view, and each expands to the SAME
    // kind of row list.
    for (const [tier, label] of [
      ['additive', 'Brand new field'],
      ['cosmetic', 'Renamed section'],
      ['semantic', 'Newly required field'],
    ] as const) {
      const scope = await group(tier);
      expect(within(scope).queryByText(label, {exact: false})).toBeNull();
      await userEvent.click(within(scope).getByRole('button'));
      expect(
        within(await group(tier)).getByText(label, {exact: false}),
      ).toBeInTheDocument();
    }
  });

  it('puts the row count in each collapsed tier trigger', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(ONE_PER_TIER));
    renderSheet();

    const scope = await group('additive');
    const trigger = within(scope).getByRole('button');
    expect(trigger).toHaveTextContent(templateConfig.diffTierAdditive);
    expect(trigger).toHaveTextContent('1');
  });
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

/** All 14, every one in the open tier so no disclosure hides a gap. */
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
  it('reaches all 14 generated variants from a rendered row', async () => {
    expect(Object.keys(VARIANT_SENTENCE)).toHaveLength(14);
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

describe('TemplateConfigDiffSheet — recorded-work badge (D6)', () => {
  /** Every tier flagged, so only the render rule can explain one badge. */
  const FLAGGED: RowSeed[] = ONE_PER_TIER.map((seed) => ({
    ...seed,
    affects_recorded_data: true,
  }));

  it('shows the badge on destructive rows only', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk(FLAGGED));
    renderSheet();

    // Open every group so no badge can hide behind a disclosure.
    for (const tier of ['additive', 'cosmetic', 'semantic'] as const) {
      await userEvent.click(within(await group(tier)).getByRole('button'));
    }

    const badges = screen.getAllByText(templateConfig.diffRecordedWork);
    expect(badges).toHaveLength(1);
    expect(await group('destructive')).toContainElement(badges[0]);
    // The honest phrase: the set unions AI and system proposals with human
    // ones, so it can never be about "answers".
    expect(templateConfig.diffRecordedWork).not.toMatch(/answers/i);
  });
});

// ---------------------------------------------------------------------
// The trigger, and the two-modal-sheet collision it has to resolve
// ---------------------------------------------------------------------

function pendingStatus() {
  return {
    ok: true,
    data: {
      project_template_id: 't1',
      has_pending_changes: true,
      active_version: 3,
      discard_available: true,
      pending_change_count: 2,
    },
  };
}

function mockGridDeps() {
  vi.mocked(useTemplateEntityTypes).mockReturnValue({
    entityTypes: [
      {
        id: 'sec',
        name: 'sec_a',
        label: 'Section A',
        description: null,
        role: 'study_section',
        cardinality: 'one',
        parent_entity_type_id: null,
        sort_order: 1,
        fields: [
          {
            id: 'f1',
            entity_type_id: 'sec',
            name: 'q1',
            label: 'Study design',
            description: null,
            field_type: 'text',
            is_required: false,
            allowed_values: null,
            llm_description: null,
            sort_order: 1,
          },
        ],
      },
    ] as never,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useTemplateEntityTypes>);
  vi.mocked(useUpdateTemplateField).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTemplateField>);
  vi.mocked(useInsertTemplateField).mockReturnValue({
    enqueueInsert: vi.fn(),
    enqueueUpdate: vi.fn(),
  } as unknown as ReturnType<typeof useInsertTemplateField>);
  vi.mocked(useMoveTemplateField).mockReturnValue({
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useMoveTemplateField>);
  vi.mocked(useReorderTemplateFields).mockReturnValue({
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useReorderTemplateFields>);
}

/** The Configuration tab as the manager sees it: the command-bar chip and
 * the grid, siblings under an owner that holds the diff-sheet flag — the
 * same shape TemplateConfigEditor mounts, so the sheets really can collide.
 *
 * `forceDiffOpen` is OR-ed into that state for the one case that cannot
 * reach the chip (see below); everything else drives it through the UI. */
function ConfigSurface({forceDiffOpen = false}: {forceDiffOpen?: boolean}) {
  const [diffSheetOpen, setDiffSheetOpen] = useState(false);
  const diffOpen = diffSheetOpen || forceDiffOpen;
  return (
    <TooltipProvider delayDuration={0}>
      <TemplateConfigPublishControls
        projectId="p1"
        templateId="t1"
        diffSheetOpen={diffOpen}
        onDiffSheetOpenChange={setDiffSheetOpen}
      />
      <TemplateConfigGridPanel
        projectId="p1"
        templateId="t1"
        diffSheetOpen={diffOpen}
        onDeleteField={vi.fn()}
        sectionActions={{
          onCommitRename: vi.fn(),
          onDelete: vi.fn(),
          onAddPerModelSection: vi.fn(),
        }}
        onAddSection={vi.fn()}
        onAddGroup={vi.fn()}
      />
    </TooltipProvider>
  );
}

function renderConfigSurface() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ConfigSurface />, {wrapper});
}

describe('TemplateConfigDiffSheet — the draft chip is the trigger (D7)', () => {
  beforeEach(() => {
    loadTemplateConfigStatus.mockResolvedValue(pendingStatus());
    loadTemplateConfigDiff.mockResolvedValue(diffOk(ONE_PER_TIER));
    // clearAllMocks keeps implementations, so the narrow override from
    // one case would otherwise leak into the next.
    vi.mocked(useContainerNarrow).mockReturnValue(false);
    mockGridDeps();
  });

  it('exposes the chip as a real control and opens the sheet', async () => {
    renderConfigSurface();

    // The chip used to be a bare Badge — no role, no name, not a control.
    // The accessible name comes from the visible text itself (no
    // aria-label override) — Label in Name (WCAG 2.5.3).
    const trigger = await screen.findByRole('button', {
      name: templateConfig.draftChangeCountOther.replace('{{n}}', '2'),
    });
    await userEvent.click(trigger);

    expect(
      await screen.findByRole('dialog', {name: templateConfig.diffSheetTitle}),
    ).toBeInTheDocument();
  });

  it('closes the inspector sheet instead of stacking on top of it', async () => {
    vi.mocked(useContainerNarrow).mockReturnValue(true);
    const {rerender} = renderConfigSurface();

    // ⌘. opens the narrow-container inspector — a modal Sheet.
    await userEvent.click(
      screen.getByRole('textbox', {name: extraction.gridSearchPlaceholder}),
    );
    await userEvent.keyboard('{Meta>}.{/Meta}');
    expect(
      await screen.findByRole('dialog', {
        name: extraction.inspectorSheetTitle,
      }),
    ).toBeInTheDocument();

    // Flipped through the owner's prop rather than the chip ON PURPOSE: the
    // open inspector Sheet is modal, so Radix marks the command bar
    // aria-hidden and inert and the chip cannot be clicked through it. This
    // is the same value the chip's onClick produces — the click path is
    // covered by the test above; what is under test here is that the grid
    // yields when the flag flips, whatever flipped it.
    rerender(<ConfigSurface forceDiffOpen />);

    expect(
      await screen.findByRole('dialog', {name: templateConfig.diffSheetTitle}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', {name: extraction.inspectorSheetTitle}),
    ).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('TemplateConfigDiffSheet — the shapes that cannot diff (D8)', () => {
  /** Neither non-available status carries rows: the buckets stay at their
   * empty default, and `status` is the only thing that distinguishes them. */
  const notDiffable = (status: 'initial_version' | 'baseline_too_old') => ({
    ok: true,
    data: {
      project_template_id: 't1',
      status,
      changes: {additive: [], cosmetic: [], semantic: [], destructive: []},
    },
  });

  it('explains a baseline too old to compare against', async () => {
    loadTemplateConfigDiff.mockResolvedValue(notDiffable('baseline_too_old'));
    renderSheet();

    expect(
      await screen.findByText(templateConfig.diffBaselineTooOld),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(/^template-diff-group-/)).toBeNull();
  });

  it('explains a template that has never published', async () => {
    loadTemplateConfigDiff.mockResolvedValue(notDiffable('initial_version'));
    renderSheet();

    expect(
      await screen.findByText(templateConfig.diffInitialVersion),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(/^template-diff-group-/)).toBeNull();
  });

  it('never lets either shape read as "no changes"', () => {
    // Both states have unpublished changes; they just cannot be listed.
    // A single shared "nothing to show" string would be a lie in both.
    expect(templateConfig.diffInitialVersion).not.toBe(
      templateConfig.diffBaselineTooOld,
    );
    for (const line of [
      templateConfig.diffInitialVersion,
      templateConfig.diffBaselineTooOld,
    ]) {
      expect(line).not.toMatch(/no changes|nothing to (list|show|publish)/i);
    }
  });

  it('says the draft matches when the diff really is empty', async () => {
    loadTemplateConfigDiff.mockResolvedValue(diffOk([]));
    renderSheet();

    expect(await screen.findByText(templateConfig.diffEmpty)).toBeInTheDocument();
  });

  it('reports a failed read instead of an empty list', async () => {
    loadTemplateConfigDiff.mockResolvedValue({
      ok: false,
      error: {message: 'boom'},
    });
    renderSheet();

    expect(
      await screen.findByText(templateConfig.diffLoadFailed),
    ).toBeInTheDocument();
    expect(screen.queryByText(templateConfig.diffEmpty)).toBeNull();
  });
});

describe('TemplateConfigDiffSheet — attribute rows', () => {
  it('names the changed attribute and renders the before/after pair', async () => {
    loadTemplateConfigDiff.mockResolvedValue(
      diffOk([
        {
          id: 'req',
          variant: 'field_modified',
          tier: 'destructive',
          label_path: ['Section A', 'Study design'],
          attribute: 'is_required',
          before: false,
          after: true,
        },
      ]),
    );
    renderSheet();

    const rowEl = within(await group('destructive')).getByTestId(
      'template-diff-row-req',
    );
    expect(rowEl).toHaveTextContent(templateConfig.diffAttrIsRequired);
    expect(rowEl).toHaveTextContent(extraction.no);
    expect(rowEl).toHaveTextContent(extraction.yes);
  });

  it('states a validation_schema change without claiming a downstream effect', async () => {
    loadTemplateConfigDiff.mockResolvedValue(
      diffOk([
        {
          id: 'vs',
          variant: 'field_modified',
          tier: 'destructive',
          label_path: ['Section A', 'Notes'],
          attribute: 'validation_schema',
          // D3: an opaque attribute ships a STATE, never the blob and never
          // an English word — the copy layer picks the word.
          before_opaque_state: 'present',
          after_opaque_state: 'empty',
        },
      ]),
    );
    renderSheet();

    // `validation_schema` has no functional reader anywhere in the
    // product, so the row is pinned to exactly what changed — an exact
    // match is the only assertion that can catch an added claim.
    const rowEl = within(await group('destructive')).getByTestId(
      'template-diff-row-vs',
    );
    expect(rowEl.textContent).toBe(
      [
        templateConfig.changeFieldModified,
        'Section A › Notes',
        templateConfig.diffAttrValidationSchema,
        templateConfig.diffValueSet,
        '→',
        templateConfig.diffValueEmpty,
      ].join(''),
    );
  });

  it('renders a joined opaque value as data, not as a state word', async () => {
    loadTemplateConfigDiff.mockResolvedValue(
      diffOk([
        {
          id: 'units',
          variant: 'field_modified',
          tier: 'destructive',
          label_path: ['Section A', 'Dose'],
          attribute: 'allowed_units',
          // A non-empty list arrives pre-joined in `before`/`after`, with no
          // state — the sheet must print the data rather than "set".
          before: 'mg, ml',
          after: 'mg',
        },
      ]),
    );
    renderSheet();

    const rowEl = within(await group('destructive')).getByTestId(
      'template-diff-row-units',
    );
    expect(rowEl).toHaveTextContent('mg, ml');
    expect(rowEl).not.toHaveTextContent(templateConfig.diffValueSet);
  });
});

describe('TemplateConfigDiffSheet — every open reads fresh', () => {
  /** The sheet is mounted per open; this is the same mount/unmount. */
  function OpenableDiffSheet({open}: {open: boolean}) {
    return open ? (
      <TemplateConfigDiffSheet
        projectId="p1"
        templateId="t1"
        onClose={vi.fn()}
      />
    ) : null;
  }

  const removedField = (id: string, label: string) => ({
    id,
    variant: 'field_removed',
    tier: 'destructive' as const,
    label_path: ['Section A', label],
  });

  it('lists the edits made since the last open, not the cached diff', async () => {
    // The client mirrors App.tsx: a 5-minute global staleTime, and NOTHING
    // invalidates templateDiffKeys. A sheet that trusted that cache would
    // replay the first answer — claiming a publish that no longer matches
    // the draft, which is the failure this sheet exists to prevent.
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: 5 * 60 * 1000}},
    });
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    loadTemplateConfigDiff.mockResolvedValue(
      diffOk([removedField('r1', 'First edit')]),
    );
    const {rerender} = render(<OpenableDiffSheet open />, {wrapper});
    expect(
      within(await group('destructive')).getByText('Section A › First edit'),
    ).toBeInTheDocument();

    // Close the sheet, delete another field, reopen.
    rerender(<OpenableDiffSheet open={false} />);
    loadTemplateConfigDiff.mockResolvedValue(
      diffOk([removedField('r2', 'Second edit')]),
    );
    rerender(<OpenableDiffSheet open />);

    expect(
      await screen.findByText('Section A › Second edit'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Section A › First edit')).toBeNull();
    expect(loadTemplateConfigDiff).toHaveBeenCalledTimes(2);
  });
});

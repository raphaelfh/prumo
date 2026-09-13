/**
 * The ✨ config-bar trigger and the grid panel's instruction editor are
 * wired through the editor: clicking the trigger bumps `templateFocusSeq`
 * (which the panel uses to focus/reveal the inspector), and typing in the
 * panel's instruction editor updates the draft the trigger reads back
 * (`data-draft`). Neither had a test — this pins both directions cheaply
 * with stand-ins for the two real components.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {error: vi.fn(), success: vi.fn(), info: vi.fn()}),
}));
vi.mock('@/services/templateService', () => ({
  updateEntityTypeLabel: vi.fn(),
  createSection: vi.fn(),
  deleteSection: vi.fn(),
}));
vi.mock('@/services/extractionFieldService', () => ({
  insertField: vi.fn(),
}));
vi.mock('@/hooks/extraction/useTemplateRepublish', () => ({
  useTemplateConfigCaches: vi.fn(() => ({invalidateStructure: vi.fn()})),
}));
vi.mock('@/hooks/extraction/useDeleteTemplateField', () => ({
  useDeleteTemplateField: vi.fn(() => ({mutate: vi.fn(), isPending: false})),
}));
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: vi.fn(() => ({
    entityTypes: [
      {
        id: 'sec',
        name: 'sec_a',
        label: 'Section A',
        description: null,
        cardinality: 'one',
        parent_entity_type_id: null,
        sort_order: 1,
      },
    ],
    isPending: false,
    isError: false,
  })),
}));
vi.mock('./dialogs', () => ({
  AddSectionDialog: () => null,
  ImportTemplateDialog: () => null,
}));
vi.mock('@/components/extraction/template-config/TemplateConfigPublishControls', () => ({
  TemplateConfigPublishControls: () => 'publish-controls',
}));
vi.mock('@/components/extraction/template-config/TemplateExportButton', () => ({
  TemplateExportButton: () => null,
}));
vi.mock('@/components/extraction/TemplateInstructionControl', () => ({
  TemplateInstructionControl: ({
    draft,
    onActivate,
  }: {
    draft: string | null;
    onActivate: () => void;
  }) => (
    <button type="button" data-testid="instruction-trigger" data-draft={draft ?? ''} onClick={onActivate}>
      trigger
    </button>
  ),
}));
vi.mock('@/components/extraction/template-config/TemplateConfigGridPanel', () => ({
  TemplateConfigGridPanel: ({
    templateFocusSeq,
    instruction,
  }: {
    templateFocusSeq: number;
    instruction: {draft: string | null; onDraftChange: (draft: string | null) => void};
  }) => (
    <div>
      <span data-testid="grid-panel" data-seq={templateFocusSeq} />
      <textarea
        data-testid="instruction-textarea"
        value={instruction.draft ?? ''}
        onChange={(e) => instruction.onDraftChange(e.target.value)}
      />
    </div>
  ),
}));

import {TemplateConfigEditor} from './TemplateConfigEditor';

const PROJECT_ID = 'p1';
const TEMPLATE_ID = 't1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplateConfigEditor — ✨ trigger / grid instruction wiring', () => {
  it('bumps templateFocusSeq on each trigger click and forwards the draft both ways', async () => {
    const user = userEvent.setup();
    render(<TemplateConfigEditor projectId={PROJECT_ID} templateId={TEMPLATE_ID} />);

    const seq = () => screen.getByTestId('grid-panel').getAttribute('data-seq');
    expect(seq()).toBe('0');

    await user.click(screen.getByTestId('instruction-trigger'));
    expect(seq()).toBe('1');

    await user.click(screen.getByTestId('instruction-trigger'));
    expect(seq()).toBe('2');

    await user.type(screen.getByTestId('instruction-textarea'), 'Focus on X');
    expect(screen.getByTestId('instruction-trigger')).toHaveAttribute('data-draft', 'Focus on X');
  });
});

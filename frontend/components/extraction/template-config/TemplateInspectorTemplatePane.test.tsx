import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/services/templateService', () => ({updateSection: vi.fn()}));
vi.mock('@/services/extractionFieldService', () => ({updateField: vi.fn()}));
vi.mock('@/components/extraction/TemplateInstructionPane', () => ({
  TemplateInstructionPane: ({templateId, draft}: {templateId: string; draft: string | null}) => (
    <textarea data-testid={`instruction-pane-${templateId}`} defaultValue={draft ?? ''} />
  ),
}));

import {TemplateInspector} from './TemplateInspector';

const base = {
  projectId: 'p1',
  templateId: 't1',
  owningSection: null,
  parentGroupLabel: null,
  onSaveField: vi.fn(),
  saving: false,
  sections: [],
  onMoveField: vi.fn(),
  moveDisabled: false,
  instruction: {draft: 'typed', onDraftChange: vi.fn()},
};

describe('TemplateInspector without a selection', () => {
  it('shows the template instruction editor with the host draft', () => {
    render(<TemplateInspector {...base} field={null} section={null} />);
    expect(screen.getByText('instructionTitle')).toBeInTheDocument();
    expect(screen.getByTestId('instruction-pane-t1')).toHaveValue('typed');
    expect(screen.getByText('inspectorEmptyHint')).toBeInTheDocument();
    expect(screen.queryByText('inspectorEmptyTitle')).toBeNull();
  });
});

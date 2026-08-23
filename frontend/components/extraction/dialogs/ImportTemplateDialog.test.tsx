// frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

// One stable array: the dialog's render-phase sync compares `templates` by
// identity, so a fresh [] per render would loop.
const NO_TEMPLATES: never[] = [];
vi.mock('@/hooks/extraction/useGlobalTemplates', () => ({
  useGlobalTemplates: () => ({templates: NO_TEMPLATES, loading: false, error: null, refresh: vi.fn()}),
}));
vi.mock('./ProjectTemplatesList', () => ({
  ProjectTemplatesList: ({onSwitched}: {onSwitched: (id: string) => void}) => (
    <button data-testid="stub-switch" onClick={() => onSwitched('switched-id')} />
  ),
}));
vi.mock('./ImportTemplateFilePane', () => ({
  ImportTemplateFilePane: ({onImported}: {onImported: (id: string) => void}) => (
    <button data-testid="stub-import" onClick={() => onImported('imported-id')} />
  ),
}));
vi.mock('@/services/templateImportService', () => ({importGlobalTemplate: vi.fn()}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ImportTemplateDialog} from './ImportTemplateDialog';

describe('ImportTemplateDialog (switch template)', () => {
  it('composes the three parts under the new title and forwards switch/import as one event', () => {
    const onOpenChange = vi.fn();
    const onActiveTemplateChanged = vi.fn();
    render(
      <ImportTemplateDialog
        projectId="p"
        open
        onOpenChange={onOpenChange}
        onActiveTemplateChanged={onActiveTemplateChanged}
      />,
    );
    expect(screen.getByTestId('import-template-dialog')).toHaveTextContent('Switch template');
    expect(screen.getByText('Add from the catalogue')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('stub-switch'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onActiveTemplateChanged).toHaveBeenCalledWith('switched-id');

    fireEvent.click(screen.getByTestId('stub-import'));
    expect(onActiveTemplateChanged).toHaveBeenCalledWith('imported-id');
  });
});

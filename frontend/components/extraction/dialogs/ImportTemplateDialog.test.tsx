// frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// One stable array: the dialog's render-phase sync compares `templates` by
// identity, so a fresh [] per render would loop.
const CATALOGUE = [
  {id: 'g1', name: 'CHARMS', description: 'd', framework: 'CHARMS', version: '1.0', entityTypesCount: 14},
];
vi.mock('@/hooks/extraction/useGlobalTemplates', () => ({
  useGlobalTemplates: () => ({templates: CATALOGUE, loading: false, error: null, refresh: vi.fn()}),
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
const importGlobalTemplate = vi.fn();
vi.mock('@/services/templateImportService', () => ({
  importGlobalTemplate: (...a: unknown[]) => importGlobalTemplate(...a),
}));
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}));
vi.mock('sonner', () => ({toast}));

import {ImportTemplateDialog} from './ImportTemplateDialog';

describe('ImportTemplateDialog (switch template)', () => {
  beforeEach(() => {
    importGlobalTemplate.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it('catalogue import closes with the new id on success and stays open on failure', async () => {
    const onOpenChange = vi.fn();
    const onActiveTemplateChanged = vi.fn();
    importGlobalTemplate.mockResolvedValueOnce({
      ok: true,
      data: {templateId: 'cloned', entityTypesAdded: 14, fieldsAdded: 82},
    });
    render(
      <ImportTemplateDialog
        projectId="p"
        open
        onOpenChange={onOpenChange}
        onActiveTemplateChanged={onActiveTemplateChanged}
        initialTemplateId="g1"
      />,
    );
    fireEvent.click(screen.getByTestId('import-template-submit'));
    await waitFor(() => expect(importGlobalTemplate).toHaveBeenCalledWith('p', 'g1'));
    await waitFor(() => expect(onActiveTemplateChanged).toHaveBeenCalledWith('cloned'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalled();

    onOpenChange.mockClear();
    onActiveTemplateChanged.mockClear();
    importGlobalTemplate.mockResolvedValueOnce({ok: false, error: new Error('boom')});
    fireEvent.click(screen.getByTestId('import-template-submit'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onActiveTemplateChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

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

// frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
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
// The dialog reaches the project-template hooks (to refresh the shared list
// query), whose import graph loads the supabase client — that throws at
// module load in the env-less Frontend Tests CI job. Stub it (the convention
// for tests that pull it in); this file makes no supabase calls.
vi.mock('@/integrations/supabase/client', () => ({supabase: {}}));

import {projectTemplatesKeys} from '@/lib/query-keys/extraction';

import {ImportTemplateDialog} from './ImportTemplateDialog';

/** The two IMPORT panes refresh the shared project-template query before
 * reporting the new id, so the dialog needs a real client. `invalidateSpy`
 * counts that refresh — Switch must not add one of its own. */
function renderDialog(ui: ReactNode) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  return {...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), invalidateSpy};
}

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
    renderDialog(
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

  it('composes the three parts under the new title and forwards switch/import as one event', async () => {
    const onOpenChange = vi.fn();
    const onActiveTemplateChanged = vi.fn();
    renderDialog(
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
    await waitFor(() => expect(onActiveTemplateChanged).toHaveBeenCalledWith('switched-id'));

    fireEvent.click(screen.getByTestId('stub-import'));
    await waitFor(() => expect(onActiveTemplateChanged).toHaveBeenCalledWith('imported-id'));
  });

  it('refreshes the list for an import but NOT for a Switch', async () => {
    const {invalidateSpy} = renderDialog(
      <ImportTemplateDialog
        projectId="p"
        open
        onOpenChange={vi.fn()}
        onActiveTemplateChanged={vi.fn()}
      />,
    );

    // Switch went through the set-active mutation, which already awaited its
    // own invalidation — a second one here is a wasted round trip.
    fireEvent.click(screen.getByTestId('stub-switch'));
    await waitFor(() => expect(invalidateSpy).not.toHaveBeenCalled());

    // A file import spoke straight to the service, so nothing refreshed yet.
    fireEvent.click(screen.getByTestId('stub-import'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({queryKey: projectTemplatesKeys.all}),
    );
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

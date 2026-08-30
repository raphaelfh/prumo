// frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// One stable array: a fresh [] per render is a latent loop shape even now
// that the render-phase selection sync is gone.
const CATALOGUE = [
  {id: 'g1', name: 'CHARMS', description: 'd', framework: 'CHARMS', version: '1.0', entityTypesCount: 14},
];
vi.mock('@/hooks/extraction/useGlobalTemplates', () => ({
  useGlobalTemplates: () => ({templates: CATALOGUE, loading: false, error: null, refresh: vi.fn()}),
}));
// Both panes stay stubbed: un-stubbing ProjectTemplatesList would add its own
// query and quietly break the invalidate-count contract below.
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
// module load in the env-less Frontend Tests CI job.
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

/** Radix TabsTrigger composes mousedown/keydown/focus and NO onClick, so
 * fireEvent.click is a silent no-op — every switch goes through user-event. */
const openTab = (user: ReturnType<typeof userEvent.setup>, name: 'file' | 'project') =>
  user.click(screen.getByTestId(`import-template-tab-${name}`));

describe('ImportTemplateDialog (add a template)', () => {
  beforeEach(() => {
    importGlobalTemplate.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it('catalogue import closes with the new id on success and stays open on failure', async () => {
    const user = userEvent.setup();
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
      />,
    );

    // Nothing is pre-selected any more, so the submit starts disabled and the
    // user must pick a card first.
    expect(screen.getByTestId('import-template-submit')).toBeDisabled();
    await user.click(screen.getByRole('radio', {name: 'CHARMS'}));

    await user.click(screen.getByTestId('import-template-submit'));
    await waitFor(() => expect(importGlobalTemplate).toHaveBeenCalledWith('p', 'g1'));
    await waitFor(() => expect(onActiveTemplateChanged).toHaveBeenCalledWith('cloned'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalled();

    onOpenChange.mockClear();
    onActiveTemplateChanged.mockClear();
    importGlobalTemplate.mockResolvedValueOnce({ok: false, error: new Error('boom')});
    await user.click(screen.getByTestId('import-template-submit'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onActiveTemplateChanged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows one pane at a time under the new title, with only Close in the footer', async () => {
    const user = userEvent.setup();
    renderDialog(
      <ImportTemplateDialog
        projectId="p"
        open
        onOpenChange={vi.fn()}
        onActiveTemplateChanged={vi.fn()}
      />,
    );
    expect(screen.getByTestId('import-template-dialog')).toHaveTextContent('Add a template');

    // Catalogue is the default pane; the other two are not merely hidden,
    // Radix drops them from the DOM.
    expect(screen.getByTestId('import-template-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-import')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-switch')).not.toBeInTheDocument();

    // The old layout showed the catalogue submit and the file pane's own
    // button at once; exactly one primary action may be reachable now.
    await openTab(user, 'file');
    expect(screen.getByTestId('stub-import')).toBeInTheDocument();
    expect(screen.queryByTestId('import-template-submit')).not.toBeInTheDocument();

    await openTab(user, 'project');
    expect(screen.getByTestId('stub-switch')).toBeInTheDocument();

    // Scoped by testid: shadcn's DialogContent renders its own sr-only
    // "Close" X, so the accessible name alone is ambiguous.
    expect(screen.getByTestId('import-template-close')).toHaveTextContent('Close');
  });

  it('forwards switch and file import through the one active-template callback', async () => {
    const user = userEvent.setup();
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

    await openTab(user, 'project');
    await user.click(screen.getByTestId('stub-switch'));
    // closeWith closes BEFORE awaiting anything; closeAfterImport closes then
    // awaits the invalidation.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(onActiveTemplateChanged).toHaveBeenCalledWith('switched-id'));

    await openTab(user, 'file');
    await user.click(screen.getByTestId('stub-import'));
    await waitFor(() => expect(onActiveTemplateChanged).toHaveBeenCalledWith('imported-id'));
  });

  it('refreshes the list for an import but NOT for a Switch', async () => {
    const user = userEvent.setup();
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
    await openTab(user, 'project');
    await user.click(screen.getByTestId('stub-switch'));
    await waitFor(() => expect(invalidateSpy).not.toHaveBeenCalled());

    // A file import spoke straight to the service, so nothing refreshed yet.
    await openTab(user, 'file');
    await user.click(screen.getByTestId('stub-import'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({queryKey: projectTemplatesKeys.all}),
    );
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

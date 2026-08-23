// frontend/components/extraction/dialogs/ProjectTemplatesList.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

const setTemplateActive = vi.fn(async () => true);
const refresh = vi.fn(async () => []);
const templatesState = {
  templates: [
    {id: 'a', name: 'Current CHARMS', framework: 'CHARMS', is_active: true, created_at: '2026-08-01T00:00:00Z'},
    {id: 'b', name: 'Imported', framework: 'CUSTOM', is_active: false, created_at: '2026-08-20T00:00:00Z'},
  ],
  loading: false,
  refresh,
  setTemplateActive,
};
vi.mock('@/hooks/hitl/useHITLProjectTemplates', () => ({
  useHITLProjectTemplates: () => templatesState,
}));
const deleteTemplate = vi.fn();
vi.mock('@/services/templateImportService', () => ({
  deleteTemplate: (...a: unknown[]) => deleteTemplate(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {ProjectTemplatesList} from './ProjectTemplatesList';

function renderList(onSwitched = vi.fn()) {
  render(
    <TooltipProvider>
      <ProjectTemplatesList projectId="p" onSwitched={onSwitched} />
    </TooltipProvider>,
  );
  return onSwitched;
}

describe('ProjectTemplatesList', () => {
  beforeEach(() => {
    setTemplateActive.mockClear();
    refresh.mockClear();
    deleteTemplate.mockReset();
  });

  it('marks the active row and offers Switch/Delete only on inactive rows', () => {
    renderList();
    expect(screen.getByTestId('project-template-active-a')).toBeInTheDocument();
    expect(screen.queryByTestId('project-template-active-b')).toBeNull();
    expect(screen.queryByTestId('project-template-switch-a')).toBeNull();
    expect(screen.queryByTestId('project-template-delete-a')).toBeNull();
    expect(screen.getByTestId('project-template-switch-b')).toBeInTheDocument();
    expect(screen.getByTestId('project-template-delete-b')).toBeInTheDocument();
  });

  it('Switch activates the template and reports the id', async () => {
    const onSwitched = renderList();
    fireEvent.click(screen.getByTestId('project-template-switch-b'));
    await waitFor(() => expect(setTemplateActive).toHaveBeenCalledWith('b', true));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith('b'));
  });

  it('Delete asks for confirmation, then deletes and refreshes', async () => {
    deleteTemplate.mockResolvedValueOnce({ok: true, data: undefined});
    renderList();
    fireEvent.click(screen.getByTestId('project-template-delete-b'));
    expect(deleteTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('p', 'b'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('renders a 409 message inline', async () => {
    deleteTemplate.mockResolvedValueOnce({
      ok: false,
      error: {code: 'TEMPLATE_IN_USE', message: 'extractions already reference it'},
    });
    renderList();
    fireEvent.click(screen.getByTestId('project-template-delete-b'));
    fireEvent.click(screen.getByTestId('project-template-delete-confirm'));
    expect(await screen.findByTestId('project-template-delete-error')).toHaveTextContent(
      'extractions already reference it',
    );
  });
});

// frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const importTemplateFromFile = vi.fn();
// The real module exports the refusal class the pane branches on; only the
// api client it loads is stubbed.
vi.mock('@/integrations/api/client', () => ({apiClient: vi.fn(), ApiError: class ApiError extends Error {}}));
vi.mock('@/services/templateImportService', async (orig) => ({
  ...(await orig<typeof import('@/services/templateImportService')>()),
  importTemplateFromFile: (...a: unknown[]) => importTemplateFromFile(...a),
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {TemplatePortableRefusal} from '@/services/templateImportService';

import {ImportTemplateFilePane} from './ImportTemplateFilePane';

function pickFile() {
  const input = screen.getByTestId('import-template-file-input') as HTMLInputElement;
  const file = new File(['{}'], 'x.prumo-template.json', {type: 'application/json'});
  fireEvent.change(input, {target: {files: [file]}});
  return file;
}

describe('ImportTemplateFilePane', () => {
  beforeEach(() => importTemplateFromFile.mockReset());

  it('submit is disabled until a file is chosen', () => {
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    expect(screen.getByTestId('import-template-file-submit')).toBeDisabled();
    pickFile();
    expect(screen.getByTestId('import-template-file-submit')).toBeEnabled();
  });

  it('posts the file and reports the new template id', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: true, data: {templateId: 'new', entityTypesAdded: 2, fieldsAdded: 5},
    });
    const onImported = vi.fn();
    render(<ImportTemplateFilePane projectId="p" onImported={onImported} />);
    const file = pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    await waitFor(() => expect(importTemplateFromFile).toHaveBeenCalledWith('p', file));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('new'));
  });

  it('renders the typed rejection list, one line per issue', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: false,
      error: new TemplatePortableRefusal(
        'Invalid template file (1 issue(s)):\nsections[0].fields[1].name: String should match pattern',
        'TEMPLATE_IMPORT_INVALID',
        [{path: 'sections[0].fields[1].name', message: 'String should match pattern'}],
      ),
    });
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    const errors = await screen.findByTestId('import-template-file-errors');
    expect(errors).toHaveTextContent('The file was rejected:');
    expect(errors.querySelectorAll('li')).toHaveLength(1);
    expect(errors).toHaveTextContent('sections[0].fields[1].name: String should match pattern');
  });

  it('falls back to the message when there are no typed details', async () => {
    importTemplateFromFile.mockResolvedValueOnce({
      ok: false,
      error: new TemplatePortableRefusal(
        'Only extraction templates can be imported here.',
        'TEMPLATE_IMPORT_WRONG_KIND',
      ),
    });
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    pickFile();
    fireEvent.click(screen.getByTestId('import-template-file-submit'));
    expect(await screen.findByTestId('import-template-file-errors')).toHaveTextContent(
      'Only extraction templates can be imported here.',
    );
  });

  it('shows the trust notice', () => {
    render(<ImportTemplateFilePane projectId="p" onImported={vi.fn()} />);
    expect(screen.getByText(/Only import templates you trust/)).toBeInTheDocument();
  });
});

// frontend/components/extraction/dialogs/ImportTemplateFilePane.test.tsx
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const importTemplateFromFile = vi.fn();
vi.mock('@/services/templateImportService', () => ({
  importTemplateFromFile: (...a: unknown[]) => importTemplateFromFile(...a),
  portableIssuesFromError: (error: unknown) =>
    (error as {details?: {errors?: unknown[]}}).details?.errors ?? null,
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

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
      error: {
        code: 'TEMPLATE_IMPORT_INVALID',
        message: 'Invalid template file (1 issue(s)):\nsections[0].fields[1].name: String should match pattern',
        details: {errors: [{path: 'sections[0].fields[1].name', message: 'String should match pattern'}], error_count: 1},
      },
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
      error: {code: 'TEMPLATE_IMPORT_WRONG_KIND', message: 'Only extraction templates can be imported here.'},
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

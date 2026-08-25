// frontend/services/templateImportService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
  // Real signature: (code, message, status, traceId?, details?) — client.ts:53-60.
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public traceId?: string,
      public details?: Record<string, unknown>,
    ) {
      super(message);
    }
  },
}));

import {ApiError, apiClient} from '@/integrations/api/client';
import {
  TemplatePortableRefusal,
  createCustomTemplate,
  deleteTemplate,
  exportTemplate,
  importGlobalTemplate,
  importTemplateFromFile,
  templateExportFilename,
} from '@/services/templateImportService';

const mockedApi = vi.mocked(apiClient);

describe('templateImportService (portable)', () => {
  beforeEach(() => mockedApi.mockReset());

  it('templateExportFilename slugifies the name', () => {
    expect(templateExportFilename('CHARMS (custom) v2')).toBe('charms-custom-v2.prumo-template.json');
    expect(templateExportFilename('   ')).toBe('template.prumo-template.json');
  });

  it('exportTemplate GETs the export route and returns the unwrapped document', async () => {
    const doc = {prumo_template: 1, kind: 'extraction', name: 'T', sections: []};
    mockedApi.mockResolvedValueOnce(doc);
    const result = await exportTemplate('p1', 't1');
    expect(mockedApi).toHaveBeenCalledWith('/api/v1/projects/p1/templates/t1/export', {method: 'GET'});
    expect(result.ok && result.data).toEqual(doc);
  });

  it('importTemplateFromFile rejects a non-JSON file locally, without calling the API', async () => {
    const file = new File(['{not json'], 'x.json', {type: 'application/json'});
    const result = await importTemplateFromFile('p1', file);
    expect(result.ok).toBe(false);
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('importTemplateFromFile POSTs the parsed object and maps the clone response', async () => {
    mockedApi.mockResolvedValueOnce({
      project_template_id: 'new', version_id: 'v', entity_type_count: 3, field_count: 7, created: true,
    });
    const file = new File([JSON.stringify({prumo_template: 1})], 'x.json');
    const result = await importTemplateFromFile('p1', file);
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/import',
      expect.objectContaining({method: 'POST', body: {prumo_template: 1}, timeout: 120_000}),
    );
    expect(result.ok && result.data).toEqual({templateId: 'new', entityTypesAdded: 3, fieldsAdded: 7});
  });

  it('importGlobalTemplate POSTs the clone request and maps the response', async () => {
    mockedApi.mockResolvedValueOnce({
      project_template_id: 'cloned', version_id: 'v', entity_type_count: 14, field_count: 82, created: true,
    });
    const result = await importGlobalTemplate('p1', 'g1');
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/clone',
      expect.objectContaining({method: 'POST', body: {global_template_id: 'g1', kind: 'extraction'}}),
    );
    expect(result.ok && result.data).toEqual({templateId: 'cloned', entityTypesAdded: 14, fieldsAdded: 82});
  });

  it('createCustomTemplate POSTs the create route and maps the response', async () => {
    mockedApi.mockResolvedValueOnce({
      project_template_id: 'blank', version_id: 'v1', entity_type_count: 0, field_count: 0, created: true,
    });
    const result = await createCustomTemplate('p1', {
      name: 'My template',
      description: 'why',
      framework: 'CUSTOM',
    });
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates',
      expect.objectContaining({
        method: 'POST',
        body: {name: 'My template', description: 'why', framework: 'CUSTOM'},
      }),
    );
    expect(result.ok && result.data).toEqual({templateId: 'blank', entityTypesAdded: 0, fieldsAdded: 0});
  });

  it('createCustomTemplate omits description entirely when not supplied', async () => {
    mockedApi.mockResolvedValueOnce({
      project_template_id: 'blank', version_id: 'v1', entity_type_count: 0, field_count: 0, created: true,
    });
    // The server defaults `description` to None, so absent and null are the
    // same request — the draft goes through untouched rather than being rebuilt.
    await createCustomTemplate('p1', {name: 'No description', framework: 'CUSTOM'});
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates',
      expect.objectContaining({body: {name: 'No description', framework: 'CUSTOM'}}),
    );
  });

  it('createCustomTemplate surfaces a server refusal as an error result', async () => {
    mockedApi.mockRejectedValueOnce(
      new ApiError('HTTP_ERROR', 'Another template was activated at the same time; retry.', 409),
    );
    const result = await createCustomTemplate('p1', {name: 'Racing', framework: 'CUSTOM'});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Another template was activated at the same time; retry.');
  });

  it('importGlobalTemplate surfaces the server 404 as an error result', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError('HTTP_ERROR', 'Global template x not found', 404));
    const result = await importGlobalTemplate('p1', 'x');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('Global template x not found');
  });

  it('deleteTemplate DELETEs the template route', async () => {
    mockedApi.mockResolvedValueOnce({project_template_id: 't1', deleted: true});
    const result = await deleteTemplate('p1', 't1');
    expect(mockedApi).toHaveBeenCalledWith('/api/v1/projects/p1/templates/t1', {method: 'DELETE'});
    expect(result.ok).toBe(true);
  });

  it('a 422 refusal surfaces as TemplatePortableRefusal with validated issues', async () => {
    mockedApi.mockRejectedValueOnce(
      new ApiError('TEMPLATE_IMPORT_INVALID', 'Invalid', 422, undefined, {
        errors: [
          {path: 'sections[0].fields[1].name', message: 'bad'},
          {path: 'dropped'}, // no message → filtered, never rendered as "undefined"
        ],
        error_count: 7,
      }),
    );
    const result = await importTemplateFromFile('p1', new File(['{}'], 'x.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TemplatePortableRefusal);
    const refusal = result.error as TemplatePortableRefusal;
    expect(refusal.code).toBe('TEMPLATE_IMPORT_INVALID');
    expect(refusal.issues).toEqual([{path: 'sections[0].fields[1].name', message: 'bad'}]);
    expect(refusal.errorCount).toBe(7);
  });

  it('exportTemplate surfaces a 422 refusal as TemplatePortableRefusal', async () => {
    mockedApi.mockRejectedValueOnce(
      new ApiError('TEMPLATE_EXPORT_INVALID', 'cannot export', 422, undefined, {
        errors: [{path: 'sections[0].fields[2].allowed_values', message: 'too short'}],
        error_count: 1,
      }),
    );
    const result = await exportTemplate('p1', 't1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TemplatePortableRefusal);
    expect((result.error as TemplatePortableRefusal).code).toBe('TEMPLATE_EXPORT_INVALID');
  });

  it('a non-portable ApiError passes through unchanged', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError('CONFLICT', 'busy', 409));
    const result = await importTemplateFromFile('p1', new File(['{}'], 'x.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toBeInstanceOf(TemplatePortableRefusal);
    expect(result.error.message).toBe('busy');
  });
});

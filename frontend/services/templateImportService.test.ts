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
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getUser: vi.fn(async () => ({data: {user: {id: 'u'}}}))}},
}));

import {ApiError, apiClient} from '@/integrations/api/client';
import {
  TemplatePortableRefusal,
  deleteTemplate,
  exportTemplate,
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

  it('a non-portable ApiError passes through unchanged', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError('CONFLICT', 'busy', 409));
    const result = await importTemplateFromFile('p1', new File(['{}'], 'x.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toBeInstanceOf(TemplatePortableRefusal);
    expect(result.error.message).toBe('busy');
  });
});

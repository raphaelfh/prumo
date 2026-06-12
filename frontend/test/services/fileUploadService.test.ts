// frontend/test/services/fileUploadService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Stub the Supabase client so importing the service is side-effect-free in tests.
vi.mock('@/integrations/supabase/client', () => {
  const storageBucket = {
    upload: vi.fn(),
    remove: vi.fn(),
  };
  const storage = {from: vi.fn(() => storageBucket)};
  const from = vi.fn();
  return {supabase: {storage, from, auth: {getUser: vi.fn()}}};
});

// Stub file-validation helpers so tests don't need real File instances.
vi.mock('@/lib/file-validation', () => ({
  validateFile: vi.fn(),
  detectFileFormat: vi.fn(() => 'PDF'),
  generateStorageKey: vi.fn(() => 'project/article/file.pdf'),
}));

import {supabase} from '@/integrations/supabase/client';
import {validateFile, generateStorageKey} from '@/lib/file-validation';
import {uploadArticleFile, uploadQueuedFile} from '@/services/fileUploadService';
import {FILE_ERROR_MESSAGES} from '@/lib/file-constants';

function makeFile(name = 'file.pdf', size = 1024): File {
  // Vitest runs in a browser-like env that provides File.
  return new File(['x'.repeat(size)], name, {type: 'application/pdf'});
}

function chain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, () => unknown> = {};
  c.insert = vi.fn(() => c);
  c.select = vi.fn(() => c);
  c.single = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('uploadArticleFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns {success:false} when file validation fails', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: false, error: 'bad file'});
    const result = await uploadArticleFile(makeFile(), 'p1', 'a1', 'MAIN' as never);
    expect(result).toEqual({success: false, error: 'bad file'});
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it('returns {success:false} when storage upload errors', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: true, detectedFormat: 'PDF' as never});
    const storageBucket = supabase.storage.from('articles') as unknown as {upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>};
    storageBucket.upload.mockResolvedValue({error: {message: 'quota exceeded'}});

    const result = await uploadArticleFile(makeFile(), 'p1', 'a1', 'MAIN' as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain('quota exceeded');
  });

  it('returns {success:true, articleFile} on happy path', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: true, detectedFormat: 'PDF' as never});
    const storageBucket = supabase.storage.from('articles') as unknown as {upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>};
    storageBucket.upload.mockResolvedValue({error: null});

    const fakeFile = {id: 'file-id', project_id: 'p1', article_id: 'a1', storage_key: 'key'};
    vi.mocked(supabase.from).mockReturnValue(chain({data: fakeFile}) as never);

    const result = await uploadArticleFile(makeFile(), 'p1', 'a1', 'MAIN' as never);
    expect(result).toEqual({success: true, articleFile: fakeFile});
  });

  it('rolls back storage when DB insert fails', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: true, detectedFormat: 'PDF' as never});
    vi.mocked(generateStorageKey).mockReturnValue('the-key');

    const storageBucket = supabase.storage.from('articles') as unknown as {upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>};
    storageBucket.upload.mockResolvedValue({error: null});
    storageBucket.remove.mockResolvedValue({error: null});

    vi.mocked(supabase.from).mockReturnValue(
      chain({data: null, error: {message: 'unique constraint'}}) as never,
    );

    const result = await uploadArticleFile(makeFile(), 'p1', 'a1', 'MAIN' as never);
    expect(result.success).toBe(false);
    expect(result.error).toContain('unique constraint');
    expect(storageBucket.remove).toHaveBeenCalledWith(['the-key']);
  });

  it('returns {success:false} with UPLOAD_FAILED when a non-Error is thrown', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: true, detectedFormat: 'PDF' as never});
    const storageBucket = supabase.storage.from('articles') as unknown as {upload: ReturnType<typeof vi.fn>};
    storageBucket.upload.mockRejectedValue('network gone');

    const result = await uploadArticleFile(makeFile(), 'p1', 'a1', 'MAIN' as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe(FILE_ERROR_MESSAGES.UPLOAD_FAILED);
  });
});

describe('uploadQueuedFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when file validation fails', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: false, error: 'too big'});
    const map = new Map<string, AbortController>();
    await expect(
      uploadQueuedFile({
        projectId: 'p1',
        articleId: 'a1',
        fileRole: 'MAIN' as never,
        abortControllersRef: map,
        itemId: 'item-1',
        file: makeFile(),
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('too big');
    // Controller is not added when validation fails before the try block
    expect(map.has('item-1')).toBe(false);
  });

  it('cleans up abort controller on success', async () => {
    vi.mocked(validateFile).mockReturnValue({valid: true, detectedFormat: 'PDF' as never});
    const storageBucket = supabase.storage.from('articles') as unknown as {upload: ReturnType<typeof vi.fn>};
    storageBucket.upload.mockResolvedValue({error: null});

    const fakeFile = {id: 'qf-1'};
    vi.mocked(supabase.from).mockReturnValue(chain({data: fakeFile}) as never);

    const map = new Map<string, AbortController>();
    const result = await uploadQueuedFile({
      projectId: 'p1',
      articleId: 'a1',
      fileRole: 'MAIN' as never,
      abortControllersRef: map,
      itemId: 'item-1',
      file: makeFile(),
      onProgress: vi.fn(),
    });

    expect(result).toEqual(fakeFile);
    // Controller cleaned up by finally
    expect(map.has('item-1')).toBe(false);
  });
});

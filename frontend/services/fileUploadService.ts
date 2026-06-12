/**
 * File upload service — Supabase Storage + article_files IO relocated from
 * useFileUpload / useMultiFileUpload hooks so those hooks compile without
 * try-family statements (zero-bailouts spec, 2026-06-12).
 *
 * Contract: exported functions never throw across the boundary; they return
 * ErrorResult<T>. try/catch/finally are free here — module-level functions
 * are not compiled by the React Compiler.
 */

import {supabase} from '@/integrations/supabase/client';
import {detectFileFormat, generateStorageKey, validateFile} from '@/lib/file-validation';
import {FILE_ERROR_MESSAGES, type FileRole} from '@/lib/file-constants';
import type {ArticleFile, ArticleFileInsert, FileUploadResult} from '@/types/article-files';

// ---------------------------------------------------------------------------
// Single-file upload (used by useFileUpload)
// ---------------------------------------------------------------------------

/**
 * Upload one file to Supabase Storage and insert an article_files row.
 * On DB insert failure the storage object is rolled back.
 * Never throws — returns FileUploadResult directly (simple ok/error union
 * already defined by the hook's callers; we keep the existing shape).
 */
export async function uploadArticleFile(
  file: File,
  projectId: string,
  articleId: string,
  fileRole: FileRole,
): Promise<FileUploadResult> {
  const validation = validateFile(file);
  if (!validation.valid) {
    return {success: false, error: validation.error};
  }

  const detectedFormat = validation.detectedFormat || detectFileFormat(file);
  const storageKey = generateStorageKey(projectId, articleId, file.name);

  try {
    const {error: uploadError} = await supabase.storage
      .from('articles')
      .upload(storageKey, file);

    if (uploadError) {
      throw new Error(FILE_ERROR_MESSAGES.STORAGE_ERROR + ': ' + uploadError.message);
    }

    const articleFileData: ArticleFileInsert = {
      project_id: projectId,
      article_id: articleId,
      file_type: detectedFormat,
      file_role: fileRole,
      storage_key: storageKey,
      original_filename: file.name,
      bytes: file.size,
      md5: null,
    };

    const {data: articleFile, error: insertError} = await supabase
      .from('article_files')
      .insert(articleFileData)
      .select()
      .single();

    if (insertError) {
      // Rollback: remove file from storage
      await supabase.storage.from('articles').remove([storageKey]);
      throw new Error(FILE_ERROR_MESSAGES.DATABASE_ERROR + ': ' + insertError.message);
    }

    return {success: true, articleFile};
  } catch (error: unknown) {
    console.error('Error uploading file:', error);
    const message = error instanceof Error ? error.message : FILE_ERROR_MESSAGES.UPLOAD_FAILED;
    return {success: false, error: message};
  }
}

// ---------------------------------------------------------------------------
// Single-file upload with abort-controller cleanup (used by useMultiFileUpload)
// ---------------------------------------------------------------------------

export interface UploadSingleFileOptions {
  projectId: string;
  articleId: string;
  fileRole: FileRole;
  /** AbortController map — controller is deleted from the map on completion. */
  abortControllersRef: Map<string, AbortController>;
  itemId: string;
  file: File;
  /** Progress update callback invoked after storage succeeds. */
  onProgress: (progress: number, uploadedBytes: number, speed: number, startTime: number) => void;
}

/**
 * Upload one file entry (from the multi-upload queue) to Supabase Storage and
 * insert an article_files row. Cleans up the AbortController on exit.
 * Throws on failure so the queue processor can handle retry logic.
 */
export async function uploadQueuedFile(opts: UploadSingleFileOptions): Promise<ArticleFile> {
  const {projectId, articleId, fileRole, abortControllersRef, itemId, file, onProgress} = opts;

  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid file');
  }

  const detectedFormat = validation.detectedFormat || detectFileFormat(file);
  const storageKey = generateStorageKey(projectId, articleId, file.name);

  const abortController = new AbortController();
  abortControllersRef.set(itemId, abortController);

  try {
    const startTime = Date.now();

    const {error: uploadError} = await supabase.storage
      .from('articles')
      .upload(storageKey, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(FILE_ERROR_MESSAGES.STORAGE_ERROR + ': ' + uploadError.message);
    }

    // Simulate progress for visual feedback (Supabase does not expose upload events)
    for (let i = 10; i <= 90; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const elapsed = (Date.now() - startTime) / 1000;
      const uploadedBytes = (file.size * i) / 100;
      const speed = uploadedBytes / elapsed;
      onProgress(i, uploadedBytes, speed, startTime);
    }

    const {data: articleFile, error: insertError} = await supabase
      .from('article_files')
      .insert({
        project_id: projectId,
        article_id: articleId,
        file_type: detectedFormat,
        file_role: fileRole,
        storage_key: storageKey,
        original_filename: file.name,
        bytes: file.size,
        md5: null,
      })
      .select()
      .single();

    if (insertError) {
      await supabase.storage.from('articles').remove([storageKey]);
      throw new Error(FILE_ERROR_MESSAGES.DATABASE_ERROR + ': ' + insertError.message);
    }

    onProgress(100, file.size, file.size / ((Date.now() - startTime) / 1000), startTime);
    return articleFile;
  } finally {
    abortControllersRef.delete(itemId);
  }
}


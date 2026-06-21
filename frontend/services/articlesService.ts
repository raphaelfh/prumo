// frontend/services/articlesService.ts
/**
 * Articles service — IO for article CRUD, file management, storage
 * operations, and project-scoped article list queries.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. Supabase calls relocated verbatim from article
 * components (no new reads); the data-path consolidation owns the
 * typed-client swap.
 */
import {supabase} from '@/integrations/supabase/client';
import {apiClient} from '@/integrations/api';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import {detectFileFormat} from '@/lib/file-validation';
import {FILE_ROLES, type FileRole} from '@/lib/file-constants';

// ---------------------------------------------------------------------------
// confirmArticleFileUpload: register a storage object via the backend endpoint
// ---------------------------------------------------------------------------

interface ConfirmUploadParams {
  articleId: string;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  bytes: number;
  fileRole: FileRole;
}

function confirmArticleFileUpload(p: ConfirmUploadParams): Promise<unknown> {
  return apiClient(`/api/v1/articles/${p.articleId}/files`, {
    method: 'POST',
    body: {
      articleId: p.articleId,
      storageKey: p.storageKey,
      originalFilename: p.originalFilename,
      contentType: p.contentType,
      bytes: p.bytes,
      fileRole: p.fileRole,
    },
  });
}

// ---------------------------------------------------------------------------
// Shared insert payload type (used by addArticle and saveArticle)
// ---------------------------------------------------------------------------

export interface ArticleInsertData {
  project_id: string;
  title: string;
  abstract: string | null;
  authors: string[] | null;
  publication_year: number | null;
  publication_month: number | null;
  publication_day?: number | null;
  journal_title: string | null;
  journal_issn: string | null;
  journal_eissn?: string | null;
  journal_publisher?: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxiv_id?: string | null;
  pii?: string | null;
  keywords: string[] | null;
  mesh_terms?: string[] | null;
  url_landing: string | null;
  url_pdf?: string | null;
  language?: string | null;
  article_type?: string | null;
  publication_status?: string | null;
  study_design?: string | null;
  conflicts_of_interest?: string | null;
  data_availability?: string | null;
  open_access?: boolean;
  license?: string | null;
  ingestion_source?: string;
  source_lineage?: string;
  sync_state?: string;
}

// ---------------------------------------------------------------------------
// AddArticleDialog: insert article + optional PDF upload with rollback
// ---------------------------------------------------------------------------

export interface AddArticleResult {
  articleId: string;
}

export interface PdfUploadInput {
  file: File;
  detectedFormat: string;
}

/**
 * Inserts an article row and optionally uploads a PDF file.
 * The storage key is built here (after insert) so it embeds the real articleId.
 * On upload failure the article row is rolled back.
 * NOTE: thrown messages surface in caller toasts via result.error.message —
 * keep them terse; user-facing copy belongs to the component's copy keys.
 */
export function addArticle(
  articleData: ArticleInsertData,
  pdfInput: PdfUploadInput | null,
): Promise<ErrorResult<AddArticleResult>> {
  return toResult(async () => {
    const {data: article, error: articleError} = await supabase
      .from('articles')
      .insert([articleData])
      .select()
      .single();

    if (articleError) throw articleError;

    if (pdfInput && article) {
      const fileExt = pdfInput.file.name.split('.').pop();
      const storageKey = `${articleData.project_id}/${article.id}/${Date.now()}.${fileExt}`;

      const {error: uploadError} = await supabase.storage
        .from('articles')
        .upload(storageKey, pdfInput.file);

      if (uploadError) {
        // Rollback: delete the newly created article row
        await supabase.from('articles').delete().eq('id', article.id);
        throw new Error('Upload failed: ' + uploadError.message);
      }

      try {
        await confirmArticleFileUpload({
          articleId: article.id,
          storageKey,
          originalFilename: pdfInput.file.name,
          contentType: pdfInput.detectedFormat,
          bytes: pdfInput.file.size,
          fileRole: FILE_ROLES.MAIN,
        });
      } catch (e) {
        // Rollback: remove storage object and article row
        await supabase.storage.from('articles').remove([storageKey]);
        await supabase.from('articles').delete().eq('id', article.id);
        throw e instanceof Error ? e : new Error('File registration failed');
      }
    }

    return {articleId: article.id};
  }, 'articlesService.addArticle');
}

// ---------------------------------------------------------------------------
// ArticleForm: save article (insert or update)
// ---------------------------------------------------------------------------

/**
 * Inserts a new article row (add mode).
 */
export function insertArticle(
  articleData: ArticleInsertData,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('articles')
      .insert([articleData])
      .select()
      .single();
    if (error) throw error;
  }, 'articlesService.insertArticle');
}

/**
 * Updates an existing article row (edit mode).
 */
export function updateArticle(
  articleId: string,
  articleData: Omit<ArticleInsertData, 'ingestion_source' | 'source_lineage' | 'sync_state'>,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('articles')
      .update(articleData)
      .eq('id', articleId)
      .select()
      .single();
    if (error) throw error;
  }, 'articlesService.updateArticle');
}

// ---------------------------------------------------------------------------
// ArticleDetailDialog / ArticleForm: load single article
// ---------------------------------------------------------------------------

/**
 * Fetches a single article by ID.
 */
export function fetchArticle(articleId: string): Promise<ErrorResult<Record<string, unknown>>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }, 'articlesService.fetchArticle');
}

// ---------------------------------------------------------------------------
// ArticleDetailDialog / ArticleForm: load article files
// ---------------------------------------------------------------------------

export interface ArticleFileRecord {
  id: string;
  file_type: string;
  file_role?: string | null;
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
}

/**
 * Fetches all files for a given article, newest first.
 */
export function fetchArticleFiles(articleId: string): Promise<ErrorResult<ArticleFileRecord[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('article_files')
      .select('*')
      .eq('article_id', articleId)
      .order('created_at', {ascending: false});
    if (error) throw error;
    return (data ?? []) as ArticleFileRecord[];
  }, 'articlesService.fetchArticleFiles');
}

// ---------------------------------------------------------------------------
// ArticleDetailDialog / ArticleForm: file download (blob)
// ---------------------------------------------------------------------------

/**
 * Downloads a file blob from storage.
 */
export function downloadFileBlob(storageKey: string): Promise<ErrorResult<Blob>> {
  return toResult(async () => {
    const {data, error} = await supabase.storage
      .from('articles')
      .download(storageKey);
    if (error) throw error;
    return data;
  }, 'articlesService.downloadFileBlob');
}

// ---------------------------------------------------------------------------
// ArticleDetailDialog / ArticleForm: delete article file
// ---------------------------------------------------------------------------

/**
 * Deletes an article_files record and its corresponding storage object.
 * Storage deletion is best-effort (non-fatal warning on failure).
 */
export function deleteArticleFile(
  fileId: string,
  storageKey: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    // Best-effort: remove from storage first
    const {error: storageError} = await supabase.storage
      .from('articles')
      .remove([storageKey]);
    if (storageError) {
      // Non-fatal: continue to DB delete
      console.warn('articlesService.deleteArticleFile: storage removal warning:', storageError);
    }

    const {error: dbError} = await supabase
      .from('article_files')
      .delete()
      .eq('id', fileId);
    if (dbError) throw dbError;
  }, 'articlesService.deleteArticleFile');
}

// ---------------------------------------------------------------------------
// ArticleFileUploadDialogNew: check if MAIN file already exists
// ---------------------------------------------------------------------------

export interface MainFileInfo {
  filename: string | null;
}

/**
 * Returns the MAIN file info for an article, or null if none exists.
 */
export function fetchMainFileInfo(articleId: string): Promise<ErrorResult<MainFileInfo | null>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('article_files')
      .select('id, original_filename, file_role')
      .eq('article_id', articleId)
      .eq('file_role', FILE_ROLES.MAIN)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return {filename: (data as {original_filename?: string | null}).original_filename ?? null};
  }, 'articlesService.fetchMainFileInfo');
}

// ---------------------------------------------------------------------------
// ArticleFileUploadDialogNew: upload a single file
// ---------------------------------------------------------------------------

export interface UploadFileParams {
  projectId: string;
  articleId: string;
  storageKey: string;
  file: File;
  role: FileRole;
}

/**
 * Uploads a file to storage and registers it in article_files.
 * On DB insert failure, rolls back the storage upload.
 * NOTE: thrown messages surface in caller error state via error.message.
 */
export function uploadArticleFile(params: UploadFileParams): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const detectedFormat = detectFileFormat(params.file);

    const {error: uploadError} = await supabase.storage
      .from('articles')
      .upload(params.storageKey, params.file);

    if (uploadError) throw new Error('Upload failed: ' + uploadError.message);

    try {
      await confirmArticleFileUpload({
        articleId: params.articleId,
        storageKey: params.storageKey,
        originalFilename: params.file.name,
        contentType: detectedFormat,
        bytes: params.file.size,
        fileRole: params.role,
      });
    } catch (e) {
      await supabase.storage.from('articles').remove([params.storageKey]);
      throw e instanceof Error ? e : new Error('File registration failed');
    }
  }, 'articlesService.uploadArticleFile');
}

// ---------------------------------------------------------------------------
// ArticlesList: fetch articles with MAIN file (for PDF badge)
// ---------------------------------------------------------------------------

/**
 * Fetches article_ids that have a MAIN file, given a list of article IDs.
 */
export function fetchArticleIdsWithMainFile(
  articleIds: string[],
): Promise<ErrorResult<string[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('article_files')
      .select('article_id')
      .in('article_id', articleIds)
      .eq('file_role', 'MAIN');
    if (error) throw error;
    return (data ?? []).map((f: {article_id: string}) => f.article_id);
  }, 'articlesService.fetchArticleIdsWithMainFile');
}

// ---------------------------------------------------------------------------
// ArticlesList: open PDF via signed URL
// ---------------------------------------------------------------------------

export interface SignedPdfUrl {
  signedUrl: string;
}

/** Resolves to null when the article has no MAIN PDF (caller decides messaging). */
export function fetchArticlePdfSignedUrl(articleId: string): Promise<ErrorResult<string | null>> {
  return toResult(async () => {
    const {data: fileData, error: fileError} = await supabase
      .from('article_files')
      .select('storage_key, original_filename')
      .eq('article_id', articleId)
      .eq('file_role', 'MAIN')
      .maybeSingle();

    if (fileError || !fileData) return null;

    const {data: signedUrl, error: urlError} = await supabase.storage
      .from('articles')
      .createSignedUrl((fileData as {storage_key: string}).storage_key, 3600);

    if (urlError) throw new Error('Could not create signed URL');
    return (signedUrl as {signedUrl: string}).signedUrl;
  }, 'articlesService.fetchArticlePdfSignedUrl');
}

// ---------------------------------------------------------------------------
// ArticlesList: delete a single article with its files
// ---------------------------------------------------------------------------

/**
 * Deletes an article row and all associated storage objects.
 * Storage deletion is best-effort (non-fatal warning on partial failure).
 */
export function deleteArticle(articleId: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {data: files, error: filesError} = await supabase
      .from('article_files')
      .select('storage_key')
      .eq('article_id', articleId);

    if (filesError) throw filesError;

    if (files && files.length > 0) {
      const filePaths = (files as {storage_key: string}[]).map(f => f.storage_key);
      const {error: storageError} = await supabase.storage
        .from('articles')
        .remove(filePaths);
      if (storageError) {
        console.warn('articlesService.deleteArticle: storage removal warning:', storageError);
      }
    }

    const {error: deleteError} = await supabase
      .from('articles')
      .delete()
      .eq('id', articleId);

    if (deleteError) throw deleteError;
  }, 'articlesService.deleteArticle');
}

// ---------------------------------------------------------------------------
// ArticleDetailDialog: trigger a re-parse for a stuck article file
// ---------------------------------------------------------------------------

/**
 * Enqueues a re-parse job for the given article file.
 * Returns ok:true on success; ok:false with error.message on failure.
 */
export function reparseArticleFile(articleFileId: string): Promise<ErrorResult<unknown>> {
  return toResult(
    () => apiClient(`/api/v1/article-files/${articleFileId}/reparse`, {method: 'POST'}),
    'articlesService.reparseArticleFile',
  );
}

// ---------------------------------------------------------------------------
// ExtractionInterface: article list for dashboard stats
// ---------------------------------------------------------------------------

export interface ArticleRow {
  id: string;
  title: string;
  doi?: string | null;
  created_at: string;
}

/**
 * Load articles for a project (for dashboard stats in ExtractionInterface).
 * Single-query relocation: no test needed.
 */
export function loadProjectArticles(
  projectId: string,
): Promise<ErrorResult<ArticleRow[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('articles')
      .select('id, title, doi, created_at')
      .eq('project_id', projectId)
      .order('created_at', {ascending: false});

    if (error) throw error;

    return (data || []) as ArticleRow[];
  }, 'articlesService.loadProjectArticles');
}

// ---------------------------------------------------------------------------
// ArticleExtractionTable: article list load
// ---------------------------------------------------------------------------

export interface ArticleTableRow {
  id: string;
  title: string;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

/**
 * Load articles for the ArticleExtractionTable.
 */
export function loadExtractionTableArticles(
  projectId: string,
): Promise<ErrorResult<ArticleTableRow[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('articles')
      .select('id, title, authors, publication_year, created_at')
      .eq('project_id', projectId)
      .order('created_at', {ascending: false});

    if (error) throw error;

    return (data || []) as ArticleTableRow[];
  }, 'articlesService.loadExtractionTableArticles');
}

// ---------------------------------------------------------------------------
// ArticlesList: bulk delete articles with their files
// ---------------------------------------------------------------------------

/**
 * Deletes multiple article rows and all associated storage objects.
 * Storage deletion is best-effort (non-fatal warning on partial failure).
 */
export function bulkDeleteArticles(articleIds: string[]): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {data: files, error: filesError} = await supabase
      .from('article_files')
      .select('storage_key')
      .in('article_id', articleIds);

    if (filesError) throw filesError;

    if (files && files.length > 0) {
      const filePaths = (files as {storage_key: string}[]).map(f => f.storage_key);
      const {error: storageError} = await supabase.storage
        .from('articles')
        .remove(filePaths);
      if (storageError) {
        console.warn('articlesService.bulkDeleteArticles: storage removal warning:', storageError);
      }
    }

    const {error: deleteError} = await supabase
      .from('articles')
      .delete()
      .in('id', articleIds);

    if (deleteError) throw deleteError;
  }, 'articlesService.bulkDeleteArticles');
}

// ---------------------------------------------------------------------------
// HITLArticleTable: project-scoped article list
// ---------------------------------------------------------------------------

export interface ArticleListItem {
  id: string;
  title: string | null;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

/**
 * Fetch all articles for a project, ordered newest first.
 * Used by HITLArticleTable for both extraction and QA HITL flows.
 *
 * NOTE: error messages are surfaced as toasts by the caller.
 */
export function fetchProjectArticles(
  projectId: string,
): Promise<ErrorResult<ArticleListItem[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('articles')
      .select('id, title, authors, publication_year, created_at')
      .eq('project_id', projectId)
      .order('created_at', {ascending: false});
    if (error) throw error;
    return (data ?? []) as ArticleListItem[];
  }, 'articlesService.fetchProjectArticles');
}

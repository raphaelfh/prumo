/**
 * Domain adapter: turn an `articleId` into a `PDFLazySource` that resolves
 * the article's MAIN file via Supabase and creates a signed URL on demand.
 *
 * Lives outside `core/` because it knows about the project's domain
 * (`article_files` table, the `MAIN` `file_role`, the `articles` storage
 * bucket). The viewer module itself stays domain-free — consumers compose
 * this adapter at the call site.
 */
import {supabase} from '@/integrations/supabase/client';
import type {PDFLazySource, PDFUrlSource} from '../core/source';

export interface ArticleFileSourceOptions {
  /** Validity window for the signed URL, in seconds. Defaults to 1 hour. */
  signedUrlTtlSeconds?: number;
  /** Storage bucket name. Defaults to 'articles'. */
  bucket?: string;
}

export class ArticleFileNotFoundError extends Error {
  constructor(articleId: string) {
    super(`No PDF (file_role='MAIN') found for article ${articleId}`);
    this.name = 'ArticleFileNotFoundError';
  }
}

/**
 * Build a lazy PDF source for an article. The actual database query +
 * signed-URL request only fires when the viewer first calls `load()`.
 */
export function articleFileSource(
  articleId: string,
  opts: ArticleFileSourceOptions = {},
): PDFLazySource {
  const {signedUrlTtlSeconds = 3600, bucket = 'articles'} = opts;

  return {
    kind: 'lazy',
    load: async (): Promise<PDFUrlSource> => {
      const {data: file, error: fileErr} = await supabase
        .from('article_files')
        .select('storage_key')
        .eq('article_id', articleId)
        .eq('file_role', 'MAIN')
        .maybeSingle();

      if (fileErr) {
        throw new Error(`Failed to fetch article file: ${fileErr.message}`);
      }
      if (!file?.storage_key) {
        throw new ArticleFileNotFoundError(articleId);
      }

      const {data: signed, error: signErr} = await supabase
        .storage
        .from(bucket)
        .createSignedUrl(file.storage_key, signedUrlTtlSeconds);

      if (signErr || !signed?.signedUrl) {
        throw new Error(
          `Failed to sign URL for article file: ${signErr?.message ?? 'unknown error'}`,
        );
      }

      return {kind: 'url', url: signed.signedUrl};
    },
  };
}

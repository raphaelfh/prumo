/**
 * Domain adapter: turn an article file's `storage_key` into a `PDFLazySource`
 * by signing the object URL on demand.
 *
 * Lives outside `core/` because it knows about the project's domain (the
 * `articles` storage bucket). The `storage_key` itself comes from the typed
 * `GET /articles/{id}/files` endpoint (resolved + membership-gated server-side)
 * — the viewer module stays domain-free, and there is NO `article_files` table
 * read on the client.
 */
import {supabase} from '@/integrations/supabase/client';
import type {PDFLazySource, PDFUrlSource} from '../core/source';

export interface ArticleFileSourceOptions {
  /** Validity window for the signed URL, in seconds. Defaults to 1 hour. */
  signedUrlTtlSeconds?: number;
  /** Storage bucket name. Defaults to 'articles'. */
  bucket?: string;
}

/**
 * Build a lazy PDF source from a known `storage_key`. The signed-URL request
 * only fires when the viewer first calls `load()`. Works for any file role
 * (MAIN or supplement) — the caller resolves which file via the document list.
 */
export function articleFileSourceFromStorageKey(
  storageKey: string,
  opts: ArticleFileSourceOptions = {},
): PDFLazySource {
  const {signedUrlTtlSeconds = 3600, bucket = 'articles'} = opts;

  return {
    kind: 'lazy',
    load: async (): Promise<PDFUrlSource> => {
      const {data: signed, error: signErr} = await supabase.storage
        .from(bucket)
        .createSignedUrl(storageKey, signedUrlTtlSeconds);

      if (signErr || !signed?.signedUrl) {
        throw new Error(
          `Failed to sign URL for article file: ${signErr?.message ?? 'unknown error'}`,
        );
      }

      return {kind: 'url', url: signed.signedUrl};
    },
  };
}

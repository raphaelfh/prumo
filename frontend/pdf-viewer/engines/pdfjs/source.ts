import type {PDFSource} from '../../core/source';

/** Resolve a source — running a lazy source's loader — to pdf.js `getDocument` params. */
export async function sourceToGetDocumentParams(
  source: PDFSource,
): Promise<{url: string} | {data: Uint8Array | ArrayBuffer}> {
  const resolved = source.kind === 'lazy' ? await source.load() : source;
  return resolved.kind === 'url' ? {url: resolved.url} : {data: resolved.data};
}

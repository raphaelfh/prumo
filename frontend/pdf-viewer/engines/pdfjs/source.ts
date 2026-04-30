import type {PDFSource} from '../../core/source';
import type {LoadOptions} from '../../core/engine';

export type PdfJsLoadParams = {
  url?: string;
  data?: Uint8Array | ArrayBuffer;
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
};

export async function sourceToGetDocumentParams(
  source: PDFSource,
  opts?: LoadOptions,
): Promise<PdfJsLoadParams> {
  const resolved = source.kind === 'lazy' ? await source.load() : source;
  const headers = {...resolved.kind === 'url' ? resolved.httpHeaders : undefined, ...opts?.httpHeaders};
  const withCredentials = (resolved.kind === 'url' && resolved.withCredentials) ?? opts?.withCredentials;

  if (resolved.kind === 'url') {
    return {
      url: resolved.url,
      withCredentials,
      httpHeaders: Object.keys(headers).length > 0 ? headers : undefined,
    };
  }
  // kind === 'data'
  return {data: resolved.data};
}

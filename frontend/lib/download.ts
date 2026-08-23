// frontend/lib/download.ts
/** Hand the browser a file to save. The object URL is revoked right after
 * the click — the download has already been handed off by then. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

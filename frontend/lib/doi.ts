/**
 * Normalises a raw DOI value (bare DOI, `doi:` prefix, or a full
 * doi.org/dx.doi.org URL) into a canonical `https://doi.org/<doi>` link.
 */
export function doiUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const path = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  if (!path) return null;
  return `https://doi.org/${path}`;
}

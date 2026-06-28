/**
 * Map a failed async-extraction job's machine-readable error code to a
 * specific toast.
 *
 * The backend (``run_section_extraction_task`` / the status endpoint) attaches
 * a stable ``ExtractionErrorCode`` to failures it can classify by type. Only
 * the codes that warrant *distinct* copy are handled here — anything else
 * (the generic ``EXTRACTION_FAILED``, or a missing/unknown code) returns
 * ``null`` so the calling hook falls back to its own generic toast.
 *
 * Pure function — no IO, no toast side effect — so the hooks stay
 * React-Compiler-clean and this mapping is unit-testable on its own.
 */
import {t} from '@/lib/copy';
import type {components} from '@/types/api/schema';

type ExtractionErrorCode = components['schemas']['ExtractionErrorCode'];

export interface JobErrorToast {
  title: string;
  description?: string;
  duration?: number;
}

export function jobErrorToast(
  code: ExtractionErrorCode | null | undefined,
  message: string,
): JobErrorToast | null {
  // Actionable failures hold the toast as long as the generic failure (8 s)
  // so the user can read the remediation. Owning the duration here keeps both
  // hooks consistent (no per-hook fallback drift).
  const duration = 8000;
  switch (code) {
    case 'MISSING_API_KEY':
      // No usable LLM key. "Authentication error" title; the backend message
      // is already actionable (BYOK key / env var), so surface it verbatim.
      return {title: t('extraction', 'sectionExtractionErrorAuth'), description: message, duration};
    case 'PDF_NOT_FOUND':
      // Missing PDF. Generic title + the actionable "Upload a PDF first" message.
      return {title: t('extraction', 'sectionExtractionErrorTitle'), description: message, duration};
    default:
      return null;
  }
}

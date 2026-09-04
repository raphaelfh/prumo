/**
 * Map a failed extraction's machine-readable error code to a specific toast,
 * for the async job path and the sync models kickoff alike.
 *
 * The backend attaches a stable ``ExtractionErrorCode`` to job failures it
 * can classify by type (``run_section_extraction_task`` / the status
 * endpoint); the sync models route serves the same code in its typed error
 * envelope. Only the codes that warrant *distinct* copy are mapped — anything
 * else (the generic ``EXTRACTION_FAILED``, or a missing/unknown code) yields
 * ``null`` so the calling hook falls back to its own generic toast.
 *
 * ``jobErrorToast`` is pure (no IO, no toast side effect) so the mapping is
 * unit-testable on its own; ``showJobErrorToast`` is the one place the hooks
 * fire it from, so title and duration never drift per hook.
 */
import {toast} from 'sonner';

import {t} from '@/lib/copy';
import type {components} from '@/types/api/schema';

type ExtractionErrorCode = components['schemas']['ExtractionErrorCode'];

export interface JobErrorToast {
  title: string;
  description?: string;
  duration?: number;
}

// Title copy per code. `satisfies` keeps every key a member of the generated
// union, so a code the backend does not emit fails typecheck; the lookup takes
// a plain string because the sync models path reads its code from the untyped
// error envelope. The backend message is actionable for all three, so it is
// always the description.
const TITLE_KEY = {
  MISSING_API_KEY: 'sectionExtractionErrorAuth',
  PDF_NOT_FOUND: 'sectionExtractionErrorTitle',
  MISSING_ENTITY_KEY: 'sectionExtractionErrorNoEntryKey',
} as const satisfies Partial<Record<ExtractionErrorCode, string>>;

function isMapped(code: string | null | undefined): code is keyof typeof TITLE_KEY {
  return code != null && Object.hasOwn(TITLE_KEY, code);
}

export function jobErrorToast(
  code: string | null | undefined,
  message: string,
): JobErrorToast | null {
  if (!isMapped(code)) {
    return null;
  }
  // Actionable failures hold the toast as long as the generic failure (8 s)
  // so the user can read the remediation.
  return {title: t('extraction', TITLE_KEY[code]), description: message, duration: 8000};
}

/** Fire the mapped toast; `false` when the code has no specific copy. */
export function showJobErrorToast(code: string | null | undefined, message: string): boolean {
  const specific = jobErrorToast(code, message);
  if (!specific) {
    return false;
  }
  toast.error(specific.title, {description: specific.description, duration: specific.duration});
  return true;
}

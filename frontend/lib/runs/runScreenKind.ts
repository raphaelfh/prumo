/**
 * Everything that differs between the two run screens' shared lifecycle,
 * in one table. ADR-0018 makes quality assessment mirror extraction, so this
 * is short on purpose: copy, the review kind the API speaks, and the few
 * surfaces one kind shows and the other does not. A new difference goes here,
 * not into a screen.
 */

import type { ReviewKind } from '@/lib/comparison/permissions';
import { t } from '@/lib/copy';

/** The UI name of a run kind (header, banner, reopen dialog). */
export type RunScreenKind = 'extraction' | 'qa';

export interface RunScreenSpec {
  /** The kind as the API names it (permissions, manager reveal). */
  reviewKind: ReviewKind;
  /** The project tab the screen exits to. */
  projectTab: string;
  /** Toast after the reviewer's Mark-ready; null = none (the next article opens). */
  markReadySuccess: string | null;
  finalizeSuccess: string;
  reopenSuccess: string;
  reopenToExtractSuccess: string;
  /** Fallback for a reopen failure without a server message. */
  reopenError: string;
  /** Blocked-click toast: its tone and the copy when the gate names no reason. */
  guideTone: 'info' | 'error';
  guideFallback: string;
  menu: { reopenRevision: string; reopening: string; reopenToExtract: string };
  /** ⌘K label of the compare toggle. */
  paletteCompare: string;
  /** Whether ⌘K also offers the kebab's reopen items. */
  paletteOffersReopen: boolean;
  /** Whether the run-scoped auto-reveal (peers_revealed) opens the compare view. */
  compareHonoursRunReveal: boolean;
  /** Whether the reviewers slot shows the advisory "N/M ready" hint in extract. */
  readyHint: boolean;
}

export function runScreenSpec(kind: RunScreenKind): RunScreenSpec {
  if (kind === 'extraction') {
    return {
      reviewKind: 'extraction',
      projectTab: 'extraction',
      markReadySuccess: null,
      finalizeSuccess: t('pages', 'extractionScreenFinalizeSuccess'),
      reopenSuccess: t('pages', 'extractionScreenReopenSuccess'),
      reopenToExtractSuccess: t('extraction', 'reopenExtractionToast'),
      reopenError: t('pages', 'extractionScreenReopenError'),
      guideTone: 'info',
      guideFallback: t('extraction', 'runHeaderGateBlocked'),
      menu: {
        reopenRevision: t('extraction', 'runHeaderReopenForRevision'),
        reopening: t('extraction', 'runHeaderReopening'),
        reopenToExtract: t('extraction', 'runHeaderReopenExtraction'),
      },
      paletteCompare: t('extraction', 'runHeaderCompareToggle'),
      paletteOffersReopen: true,
      compareHonoursRunReveal: true,
      readyHint: true,
    };
  }
  return {
    reviewKind: 'quality_assessment',
    projectTab: 'quality',
    markReadySuccess: t('qa', 'markReadySuccess'),
    finalizeSuccess: t('qa', 'finalizationSuccess'),
    reopenSuccess: t('qa', 'reopenSuccess'),
    reopenToExtractSuccess: t('qa', 'reopenAssessmentToast'),
    reopenError: t('qa', 'reopenError'),
    guideTone: 'error',
    guideFallback: t('qa', 'runHeaderApproveBlocked'),
    menu: {
      reopenRevision: t('qa', 'reopenButton'),
      reopening: t('qa', 'reopenProgress'),
      reopenToExtract: t('qa', 'reopenAssessmentMenuItem'),
    },
    paletteCompare: t('runs', 'compareToggleLabel'),
    paletteOffersReopen: false,
    compareHonoursRunReveal: false,
    readyHint: false,
  };
}

import type {PDFRect, PDFTextRange} from './coordinates';

export type CitationId = string;

/**
 * A citation — an anchored reference into a PDF document.
 *
 * `Citation` is the runtime shape; the persisted shape lives in the backend
 * `extraction_evidence.position` JSONB column with the same field names so
 * round-trips don't need a translation layer. See backend Phase 6 plan for
 * the storage schema.
 *
 * Three anchor kinds:
 *   - `text`   — char-range only (most robust to re-OCR)
 *   - `region` — bbox only (works for figures, tables, image regions)
 *   - `hybrid` — both, plus the canonical quote text (the recommended kind
 *                for AI-generated citations: max resilience)
 */
export interface Citation {
  id: CitationId;
  anchor: CitationAnchor;
  metadata?: CitationMetadata;
  style?: CitationStyle;
}

export type CitationAnchor =
  | TextCitationAnchor
  | RegionCitationAnchor
  | HybridCitationAnchor;

export interface TextCitationAnchor {
  kind: 'text';
  range: PDFTextRange;
  /** Optional canonical text used for highlight matching. */
  quote?: string;
}

export interface RegionCitationAnchor {
  kind: 'region';
  /** 1-indexed page the rect is on. */
  page: number;
  /** Bounding box in PDF user space (origin bottom-left, units in points). */
  rect: PDFRect;
}

export interface HybridCitationAnchor {
  kind: 'hybrid';
  range: PDFTextRange;
  rect: PDFRect;
  quote: string;
}

export interface CitationMetadata {
  /** ID of the extraction field this citation supports, if applicable. */
  fieldId?: string;
  /** Model confidence in [0, 1]. */
  confidence?: number;
  /** Where the citation came from. */
  source?: 'ai' | 'human' | 'review';
}

export interface CitationStyle {
  /** CSS color string for the highlight overlay. */
  color?: string;
  /** If true, the highlight is short-lived (used for "flash on click"). */
  ephemeral?: boolean;
}

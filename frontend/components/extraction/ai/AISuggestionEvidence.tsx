/**
 * Component to display AI suggestion evidence
 *
 * Accepts a list of `EvidenceCitation` items (ordered by rank — rank 0 is
 * primary). The primary citation is shown prominently; additional citations
 * are revealed under a collapsible "Also cited (n)" toggle.
 *
 * Each citation row shows:
 * - A left-border + badge in the attribution tone:
 *   GREEN  → `attributionLabel === 'entailed'`
 *   AMBER  → `'weak' | 'unsupported'`
 *   neutral → null / legacy
 * - A "Locate in document" button when `onLocate` is provided (passed per
 *   citation as `onLocate(rank)` so each row targets its own span).
 * - A copy-to-clipboard button.
 *
 * Legacy compatibility: a length-1 array with `attributionLabel: null`
 * renders exactly the old single-block layout with no toggle.
 *
 * @component
 */

import {Check, ChevronDown, ChevronUp, Copy, FileText, MapPin} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useState} from 'react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import type {ExtractionCopy} from '@/lib/copy/extraction';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import type {EvidenceCitation} from '@/types/ai-extraction';

// One source of truth mapping each attribution label to its badge copy + the
// tooltip that explains it grades the QUOTE (not the value/confidence). A new
// attribution state is added here once; copy and tooltip stay in lockstep.
const ATTRIBUTION_COPY: Record<
  'entailed' | 'weak' | 'unsupported' | 'ungroundable',
  {copy: keyof ExtractionCopy; tooltip: keyof ExtractionCopy}
> = {
  entailed: {copy: 'attributionEntailed', tooltip: 'attributionTooltipEntailed'},
  weak: {copy: 'attributionWeak', tooltip: 'attributionTooltipWeak'},
  unsupported: {copy: 'attributionUnsupported', tooltip: 'attributionTooltipUnsupported'},
  ungroundable: {copy: 'attributionUngroundable', tooltip: 'attributionTooltipUngroundable'},
};

// =================== INTERFACES ===================

interface AISuggestionEvidenceProps {
  evidence: EvidenceCitation[];
  className?: string;
  showCopyButton?: boolean;
  /**
   * Called with the rank of the citation the user clicked to locate. When
   * absent the cited passage is a plain blockquote (backward compatible).
   */
  onLocate?: (rank: number) => void;
  /**
   * Rank of the citation currently located in the reader, if any. The matching
   * passage gets a persistent active ring. The popover keeps it across clicks.
   */
  activeRank?: number | null;
}

// =================== CITATION ROW ===================

interface CitationRowProps {
  citation: EvidenceCitation;
  showCopyButton: boolean;
  onLocate?: (rank: number) => void;
  isPrimary?: boolean;
  isActive?: boolean;
}

function CitationRow({citation, showCopyButton, onLocate, isPrimary, isActive}: CitationRowProps) {
  const {copied, copy} = useCopyToClipboard();
  const [showTooltip, setShowTooltip] = useState(false);

  const label = citation.attributionLabel;
  const isEntailed = label === 'entailed';
  const isUngroundable = label === 'ungroundable';
  const isAmber = label === 'weak' || label === 'unsupported' || isUngroundable;

  // Badge text + its tooltip resolve from one table (see ATTRIBUTION_COPY). The
  // tooltip spells out that the badge grades the cited QUOTE, not the AI's
  // confidence/rationale — so "Not supported" next to a confident rationale
  // doesn't read as a contradiction.
  const attribution = label ? ATTRIBUTION_COPY[label] : undefined;
  const badgeCopy = attribution ? t('extraction', attribution.copy) : null;
  const badgeTooltip = attribution ? t('extraction', attribution.tooltip) : null;

  const borderClass = isEntailed
    ? 'border-l-green-500'
    : isAmber
      ? 'border-l-amber-500'
      : 'border-l-primary/20';

  return (
    <div className={cn(isPrimary ? 'flex flex-col gap-4' : 'flex flex-col gap-3')}>
      {/* Row header: icon + page + attribution badge + actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="font-medium">{t('extraction', 'evidenceCited')}</span>
          {citation.pageNumber !== null && citation.pageNumber !== undefined && (
            <span className="px-2 py-1 bg-background rounded text-xs shrink-0">
              {t('extraction', 'pageLabel').replace('{{n}}', String(citation.pageNumber))}
            </span>
          )}
          {badgeCopy !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  role="note"
                  aria-label={badgeTooltip ?? badgeCopy}
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium shrink-0 cursor-help',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isEntailed
                      ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
                  )}
                >
                  {badgeCopy}
                </span>
              </TooltipTrigger>
              {badgeTooltip !== null && (
                <TooltipContent side="top" className="max-w-xs">
                  <p>{badgeTooltip}</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {showCopyButton && (
            <Tooltip open={showTooltip && !copied} delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 shrink-0 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    copy(citation.text);
                    setShowTooltip(false);
                  }}
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  aria-label={copied ? t('extraction', 'copyCopied') : t('extraction', 'copySnippet')}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" onPointerDownOutside={() => setShowTooltip(false)}>
                <p>{t('extraction', 'copySnippet')}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Cited passage — the jump target when locate is available. Clicking it
          locates the passage in the reader; the popover stays open and the
          located citation keeps an active ring. */}
      {onLocate ? (
        <button
          type="button"
          data-active-citation={isActive ? 'true' : undefined}
          aria-label={isActive ? t('extraction', 'evidenceLocatedInReader') : t('extraction', 'evidenceLocate')}
          onClick={(e) => {
            e.stopPropagation();
            onLocate(citation.rank);
          }}
          className={cn(
            'group block w-full rounded-md border-l-2 py-1 pl-3 sm:pl-5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            borderClass,
            isActive ? 'bg-primary/5 ring-2 ring-primary/40' : 'hover:bg-foreground/5',
          )}
        >
          <span className="block text-sm italic leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
            "{citation.text}"
          </span>
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {isActive ? t('extraction', 'evidenceLocatedInReader') : t('extraction', 'evidenceLocate')}
          </span>
        </button>
      ) : (
        <blockquote
          className={cn(
            'text-sm text-foreground/90 italic pl-3 sm:pl-5 border-l-2 whitespace-pre-wrap break-words leading-relaxed',
            borderClass,
          )}
        >
          "{citation.text}"
        </blockquote>
      )}
    </div>
  );
}

// =================== COMPONENT ===================

export function AISuggestionEvidence(props: AISuggestionEvidenceProps) {
  const {evidence, className, showCopyButton = true, onLocate, activeRank} = props;
  const [expanded, setExpanded] = useState(false);

  if (evidence.length === 0) return null;

  const [primary, ...rest] = evidence;
  const hasExtra = rest.length > 0;

  return (
    <div className={cn('flex flex-col gap-4 p-4 bg-muted rounded-lg border', className)}>
      <CitationRow
        citation={primary}
        showCopyButton={showCopyButton}
        onLocate={onLocate}
        isActive={activeRank != null && primary.rank === activeRank}
        isPrimary
      />

      {hasExtra && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {t('extraction', 'evidenceAlsoCited').replace('{{n}}', String(rest.length))}
          </Button>

          {expanded && (
            <div className="flex flex-col gap-4 border-t pt-4">
              {rest.map((citation) => (
                <CitationRow
                  key={citation.rank}
                  citation={citation}
                  showCopyButton={showCopyButton}
                  onLocate={onLocate}
                  isActive={activeRank != null && citation.rank === activeRank}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

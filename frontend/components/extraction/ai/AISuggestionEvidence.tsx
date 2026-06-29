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
import type {EvidenceCitation} from '@/types/ai-extraction';

// =================== INTERFACES ===================

interface AISuggestionEvidenceProps {
  evidence: EvidenceCitation[];
  className?: string;
  showCopyButton?: boolean;
  /**
   * Called with the rank of the citation the user clicked "Locate" on.
   * When absent the locate button is not rendered (backward compatible).
   */
  onLocate?: (rank: number) => void;
}

// =================== CITATION ROW ===================

interface CitationRowProps {
  citation: EvidenceCitation;
  showCopyButton: boolean;
  onLocate?: (rank: number) => void;
  isPrimary?: boolean;
}

function CitationRow({citation, showCopyButton, onLocate, isPrimary}: CitationRowProps) {
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(citation.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err: unknown) => {
      console.error('Failed to copy evidence text:', err);
    });
  };

  const label = citation.attributionLabel;
  const isEntailed = label === 'entailed';
  const isUngroundable = label === 'ungroundable';
  const isAmber = label === 'weak' || label === 'unsupported' || isUngroundable;

  const badgeCopy =
    isEntailed
      ? t('extraction', 'attributionEntailed')
      : label === 'weak'
        ? t('extraction', 'attributionWeak')
        : label === 'unsupported'
          ? t('extraction', 'attributionUnsupported')
          : isUngroundable
            ? t('extraction', 'attributionUngroundable')
            : null;

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
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium shrink-0',
                isEntailed
                  ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
              )}
            >
              {badgeCopy}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onLocate && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLocate(citation.rank);
                  }}
                  aria-label={t('extraction', 'evidenceLocate')}
                >
                  <MapPin className="h-4 w-4 text-primary" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{t('extraction', 'evidenceLocate')}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {showCopyButton && (
            <Tooltip open={showTooltip && !copied} delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 shrink-0 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
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

      {/* Cited passage */}
      <blockquote
        className={cn(
          'text-sm text-foreground/90 italic pl-3 sm:pl-5 border-l-2 whitespace-pre-wrap break-words leading-relaxed',
          borderClass,
        )}
      >
        "{citation.text}"
      </blockquote>
    </div>
  );
}

// =================== COMPONENT ===================

export function AISuggestionEvidence(props: AISuggestionEvidenceProps) {
  const {evidence, className, showCopyButton = true, onLocate} = props;
  const [expanded, setExpanded] = useState(false);

  if (evidence.length === 0) return null;

  const [primary, ...rest] = evidence;
  const hasExtra = rest.length > 0;

  return (
    <div className={cn('flex flex-col gap-4 p-4 bg-muted/50 rounded-lg border', className)}>
      <CitationRow
        citation={primary}
        showCopyButton={showCopyButton}
        onLocate={onLocate}
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
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Component to display AI suggestion evidence
 *
 * Shows the text passage cited by the LLM as evidence for extraction,
 * including page number (if available).
 *
 * Optional markdown-first locate: when an `onLocate` callback is provided (by a
 * parent inside a ViewerProvider), the evidence block gains a "Locate in
 * document" button that switches the reader to the cited passage and flashes
 * it. When `onLocate` is absent the component renders exactly as before —
 * backward compatible, safe to use outside a ViewerProvider.
 *
 * @component
 */

import {Check, Copy, FileText, MapPin} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useState} from 'react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface AISuggestionEvidenceProps {
  evidence: {
    text: string;
    pageNumber?: number | null;
  };
  className?: string;
  showCopyButton?: boolean;
  /** Locate this evidence in the document reader. Provided by a parent inside a
   *  ViewerProvider; absent → the locate button is not rendered. */
  onLocate?: () => void;
}

// =================== COMPONENT ===================

export function AISuggestionEvidence(props: AISuggestionEvidenceProps) {
  const {evidence, className, showCopyButton = true, onLocate} = props;
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleCopy = async () => {
    const ok = await navigator.clipboard.writeText(evidence.text).then(() => true).catch((err: unknown) => {
      console.error('Failed to copy evidence text:', err);
      return false;
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={cn('flex flex-col gap-4 p-4 bg-muted/50 rounded-lg border', className)}>
      {/* Header with icon and page */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="font-medium">{t('extraction', 'evidenceCited')}</span>
          {evidence.pageNumber !== null && evidence.pageNumber !== undefined && (
            <span className="px-2 py-1 bg-background rounded text-xs shrink-0">
              {t('extraction', 'pageLabel').replace('{{n}}', String(evidence.pageNumber))}
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
                    onLocate();
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
      <blockquote className="text-sm text-foreground/90 italic pl-3 sm:pl-5 border-l-2 border-primary/20 whitespace-pre-wrap break-words leading-relaxed">
        "{evidence.text}"
      </blockquote>
    </div>
  );
}

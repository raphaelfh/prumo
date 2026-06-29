/**
 * AISuggestionReviewPopover — one surface to review + select AI versions.
 *
 * Replaces the split history + details popovers. Loads the proposal history for
 * a single (instance, field) coord, groups it by run (newest first), and lets
 * the reviewer SELECT any version to set the field (pure-selection model: one
 * version is "Selected"; the rest offer "Use this version"). The selected
 * version expands to show how it was generated (RunProvenanceDisclosure) and its
 * cited evidence (with reader-locate). A "no information" version renders as a
 * clean card rather than an empty value. A pinned footer keeps Clear reachable
 * no matter how long the list grows (AIPopoverShell footer slot).
 *
 * "Selected" is seeded from `selectedProposalId` (the coord's active version id,
 * which the hook updates on each selection) and tracked optimistically while
 * open; it falls back to the newest version when no selection is known.
 */

import {useEffect, useState} from 'react';
import {Check, ChevronDown, ChevronRight, Sparkles} from 'lucide-react';
import {Popover, PopoverTrigger} from '@/components/ui/popover';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import type {AISuggestionHistoryItem, EvidenceCitation} from '@/types/ai-extraction';
import {formatFullSuggestionValue, isNoInfoValue} from '@/lib/ai-extraction/suggestionUtils';
import {useReaderLocate} from '@/hooks/extraction/useReaderLocate';
import {AIPopoverShell} from './shared/AIPopoverShell';
import {RunProvenanceDisclosure} from './shared/RunProvenanceDisclosure';
import {AISuggestionEvidence} from './AISuggestionEvidence';

const LOW_CONFIDENCE = 0.5;

function formatTimestamp(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return t('extraction', 'historyInvalidDate');
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// -----------------------------------------------------------------------------
// Evidence — owns the reader-locate wiring (folded in from the details popover).
// -----------------------------------------------------------------------------

interface EvidenceSectionProps {
  evidence: EvidenceCitation[];
}

function EvidenceSection({evidence}: EvidenceSectionProps) {
  const {locate, isAvailable} = useReaderLocate();
  const [activeRank, setActiveRank] = useState<number | null>(null);

  const onLocate = isAvailable
    ? (rank: number) => {
        const citation = evidence.find((e) => e.rank === rank) ?? evidence[0];
        setActiveRank(rank);
        locate(citation.text, citation.pageNumber ?? null, citation.blockIds ?? []);
      }
    : undefined;

  return (
    <section aria-label={t('extraction', 'evidenceCitedAria')}>
      <AISuggestionEvidence evidence={evidence} onLocate={onLocate} activeRank={activeRank} />
    </section>
  );
}

// -----------------------------------------------------------------------------
// One version row
// -----------------------------------------------------------------------------

interface VersionRowProps {
  version: AISuggestionHistoryItem;
  isSelected: boolean;
  onUse: () => void;
}

function VersionRow({version, isSelected, onUse}: VersionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const showDetails = isSelected || expanded;

  const noInfo = isNoInfoValue(version.value);
  const hasReasoning = !!version.reasoning?.trim();
  const evidence = version.evidence ?? [];
  const hasEvidence = evidence.length > 0 && !!evidence[0]?.text?.trim();
  const hasDetails = !!version.provenance || hasReasoning || hasEvidence;
  const confidencePercent = Math.round(version.confidence * 100);
  const isLow = version.confidence < LOW_CONFIDENCE;

  return (
    <div
      className={cn(
        'rounded-lg border p-2.5 transition-colors duration-75',
        isSelected ? 'border-ai/30 bg-ai/10' : 'border-border/60 bg-background hover:bg-muted/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {noInfo ? (
            <div>
              <p className="text-sm font-medium text-foreground/90">
                {t('extraction', 'reviewNoInformation')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('extraction', 'reviewNoInformationDesc')}
              </p>
            </div>
          ) : (
            <p
              className="line-clamp-3 break-words text-sm font-medium"
              title={formatFullSuggestionValue(version.value)}
            >
              {formatFullSuggestionValue(version.value)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* A no-info card never shows a confidence % (a not_found 0% reads as
              misleading). Real values show their confidence + a low flag. */}
          {!noInfo && (
            <Badge variant="outline" className="bg-ai/10 text-xs text-ai border-ai/30">
              {confidencePercent}%{isLow ? ` · ${t('extraction', 'reviewLowConfidence')}` : ''}
            </Badge>
          )}
          {isSelected ? (
            <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
              <Check className="h-3 w-3" />
              {t('extraction', 'reviewSelected')}
            </span>
          ) : (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onUse}>
              {t('extraction', 'reviewUseThisVersion')}
            </Button>
          )}
        </div>
      </div>

      {/* Progressive disclosure: the selected version is expanded; others offer
          a Details toggle. */}
      {hasDetails && !isSelected && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1.5 h-6 gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t('extraction', 'reviewDetails')}
        </Button>
      )}

      {showDetails && hasDetails && (
        <div className="mt-2 space-y-2">
          {version.provenance && <RunProvenanceDisclosure provenance={version.provenance} />}
          {hasReasoning && (
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('extraction', 'aiRationaleLabel')}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                {version.reasoning}
              </p>
            </div>
          )}
          {hasEvidence && <EvidenceSection evidence={evidence} />}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Popover
// -----------------------------------------------------------------------------

interface AISuggestionReviewPopoverProps {
  instanceId: string;
  fieldId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  /** The currently-selected version id; falls back to the newest when absent. */
  selectedProposalId?: string;
  onSelect: (proposalRecordId: string, value: unknown, confidence: number) => void;
  onClear?: () => void;
  trigger: React.ReactNode;
  align?: 'start' | 'center' | 'end';
}

export function AISuggestionReviewPopover(props: AISuggestionReviewPopoverProps) {
  const {instanceId, fieldId, getHistory, selectedProposalId, onSelect, onClear, trigger, align} = props;

  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AISuggestionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Optimistic local selection so the highlight follows clicks within a session;
  // seeded from the prop (the active accept_proposal decision / newest).
  const [localSelected, setLocalSelected] = useState<string | undefined>(undefined);

  // Reset transient state on close so the next open starts fresh.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setHistory([]);
      setLocalSelected(undefined);
    }
  }

  useEffect(() => {
    if (!open) return;
    // setState lives in the microtask (not the effect body) to avoid the
    // synchronous-setState-in-effect cascade lint; mirrors the old popover.
    queueMicrotask(() => {
      setLoading(true);
      void getHistory(instanceId, fieldId)
        .then((data) => setHistory(data))
        .catch((err: unknown) => {
          console.error('[AISuggestionReviewPopover] Error loading history:', err);
          setHistory([]);
        })
        .finally(() => setLoading(false));
    });
  }, [open, instanceId, fieldId, getHistory]);

  const effectiveSelected = localSelected ?? selectedProposalId ?? history[0]?.id;

  // Group by run id, preserving the (newest-first) order the server returns.
  const runOrder: string[] = [];
  const groupedByRun: Record<string, AISuggestionHistoryItem[]> = {};
  for (const item of history) {
    const runId = item.runId || 'unknown';
    if (!groupedByRun[runId]) {
      groupedByRun[runId] = [];
      runOrder.push(runId);
    }
    groupedByRun[runId].push(item);
  }

  const handleUse = (version: AISuggestionHistoryItem) => {
    setLocalSelected(version.id);
    onSelect(version.id, version.value, version.confidence);
  };

  const handleClear = () => {
    setOpen(false);
    onClear?.();
  };

  const countLabel = loading
    ? undefined
    : t('extraction', 'reviewVersionsCount').replace('{{n}}', String(history.length));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <AIPopoverShell
        icon={<Sparkles className="h-4 w-4" />}
        title={t('extraction', 'reviewTitle')}
        count={countLabel}
        align={align}
        footer={
          onClear ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={t('extraction', 'reviewClearHint')}>
                {t('extraction', 'reviewClearHint')}
              </span>
              <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={handleClear}>
                {t('extraction', 'reviewClear')}
              </Button>
            </div>
          ) : undefined
        }
      >
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">…</div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('extraction', 'reviewNoVersions')}
          </div>
        ) : (
          <div className="space-y-3 p-2.5">
            {runOrder.map((runId, runIndex) => (
              <div key={runId} className="space-y-2">
                <div className="rounded bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                  {formatTimestamp(groupedByRun[runId][0].timestamp)}
                </div>
                {groupedByRun[runId].map((version) => (
                  <VersionRow
                    key={version.id}
                    version={version}
                    isSelected={version.id === effectiveSelected}
                    onUse={() => handleUse(version)}
                  />
                ))}
                {runIndex < runOrder.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        )}
      </AIPopoverShell>
    </Popover>
  );
}

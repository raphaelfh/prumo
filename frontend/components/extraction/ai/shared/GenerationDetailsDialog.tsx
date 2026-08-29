/**
 * GenerationDetailsDialog — the full "how this was generated" surface.
 *
 * Opened from the review popover's one-line provenance summary. Renders the run
 * parameters, the structured prompt-composition recipe (system prompt, section
 * instruction with the article replaced by a marker, article reference, and the
 * requested fields), and the token totals. Runs that predate composition capture
 * fall back to the legacy flat rows + raw prompt-text code block.
 *
 * The article chip's "view text sent" markdown expand is wired in a follow-up
 * (needs the lazy content-markdown fetch); this component renders the recipe and
 * the chip metadata.
 */

import {useState} from 'react';
import {Check, ChevronDown, ChevronRight, Copy} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import type {ExtractionCopy} from '@/lib/copy/extraction';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import {useRunEditability} from '@/components/runs/RunEditabilityContext';
import {useArticleContentMarkdown} from '@/hooks/extraction/useArticleContentMarkdown';
import type {RunProvenance} from '@/types/ai-extraction';

// Scalar run-parameter rows (ported from the old inline disclosure, minus the
// prompt text — the composition carries the system prompt, and the token counts
// get their own metric row below).
interface ScalarField {
  key: keyof RunProvenance;
  labelKey: keyof ExtractionCopy;
  format?: (value: unknown) => string;
}

const SCALAR_FIELDS: ScalarField[] = [
  {key: 'ranByName', labelKey: 'provenanceRanBy'},
  {key: 'provider', labelKey: 'provenanceProvider'},
  {key: 'model', labelKey: 'provenanceModel'},
  {key: 'reasoning', labelKey: 'provenanceReasoning'},
  {key: 'temperature', labelKey: 'provenanceTemperature'},
  {key: 'outputRetries', labelKey: 'provenanceOutputRetries'},
  {key: 'timeoutSeconds', labelKey: 'provenanceTimeout', format: (v) => `${String(v)}s`},
  {key: 'strategy', labelKey: 'provenanceStrategy'},
  {key: 'promptVersion', labelKey: 'provenancePromptVersion'},
];

const SCALAR_KEYS = new Set<string>(SCALAR_FIELDS.map((f) => f.key as string));
// Keys shown elsewhere (token metric row) or never reviewer-facing — never fall
// through to a generic row. `promptText` renders ONLY in the legacy code block.
const SUPPRESSED_KEYS = new Set<string>([
  'ranByUserId',
  // Per-proposal engine record (0056) carries the project endpoint's id on
  // custom-endpoint runs. An internal identifier, not a reviewer-facing fact —
  // without this it falls through as a generic row showing a bare UUID.
  'endpointId',
  'endpoint_id',
  'promptComposition',
  'promptText',
  'tokensPrompt',
  'tokensCompletion',
  'tokensTotal',
]);

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

function fmtNumber(value: unknown): string {
  return Number(value).toLocaleString();
}

function ScalarRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground/90" title={value}>
        {value}
      </span>
    </div>
  );
}

function CopyButton({value}: {value: string}) {
  const {copied, copy} = useCopyToClipboard();
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      className="shrink-0 p-0"
      onClick={() => copy(value)}
      aria-label={copied ? t('extraction', 'provenanceCopied') : t('extraction', 'provenanceCopyPrompt')}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

// -----------------------------------------------------------------------------
// Recipe steps
// -----------------------------------------------------------------------------

function RecipeStep({index, children}: {index: number; children: React.ReactNode}) {
  return (
    <div className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
        {index}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SystemPromptStep({index, text}: {index: number; text: string}) {
  const [open, setOpen] = useState(false);
  return (
    <RecipeStep index={index}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t('extraction', 'generationSystemPrompt')}
        </span>
        <CopyButton value={text} />
      </div>
      <pre
        className={cn(
          'mt-1 whitespace-pre-wrap break-words rounded border bg-muted/50 p-2 text-[11px] leading-relaxed text-foreground/80',
          !open && 'line-clamp-2',
        )}
      >
        {text}
      </pre>
      <Button
        size="xs"
        variant="ghost"
        className="mt-1 px-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? t('extraction', 'generationShowLess') : t('extraction', 'generationShowAll')}
      </Button>
    </RecipeStep>
  );
}

/**
 * The "view text sent" expand: lazily fetches the stored article markdown (the
 * exact text the LLM received) only when the user opens it. Renders a loading,
 * error+retry, or scrollable text state inside the article chip.
 */
function ArticleTextExpand({articleId}: {articleId: string}) {
  const [open, setOpen] = useState(false);
  const {data, isLoading, isError, refetch} = useArticleContentMarkdown(articleId, {enabled: open});
  const {copied, copy} = useCopyToClipboard();

  return (
    <div className="mt-2">
      <Button
        size="xs"
        variant="ghost"
        className="gap-1 px-1 text-[11px] text-ai hover:text-ai"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? t('extraction', 'generationHideTextSent') : t('extraction', 'generationViewTextSent')}
      </Button>
      {open && (
        <div className="mt-1">
          {isLoading && (
            <div className="h-16 animate-pulse rounded border bg-muted/40" aria-hidden />
          )}
          {isError && (
            <div className="flex items-center justify-between gap-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              <span>{t('extraction', 'generationTextError')}</span>
              <Button
                size="xs"
                variant="ghost"
                className="px-1.5 text-[11px]"
                onClick={() => void refetch()}
              >
                {t('extraction', 'generationTextRetry')}
              </Button>
            </div>
          )}
          {!isLoading && !isError && data && (
            <div className="relative">
              <Button
                size="icon-xs"
                variant="ghost"
                className="absolute right-1 top-1 p-0"
                onClick={() => copy(data.contentMarkdown ?? '')}
                aria-label={
                  copied ? t('extraction', 'provenanceCopied') : t('extraction', 'provenanceCopyPrompt')
                }
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/50 p-2 pr-8 text-[11px] leading-relaxed text-foreground/80">
                {data.contentMarkdown}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dialog
// -----------------------------------------------------------------------------

interface GenerationDetailsDialogProps {
  provenance: RunProvenance;
  /** Threaded so a follow-up can lazily fetch the stored markdown. */
  articleId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerationDetailsDialog({
  provenance,
  articleId,
  open,
  onOpenChange,
}: GenerationDetailsDialogProps) {
  // D3 display consistency: the "Ran by" surfaces follow the same
  // peer-identity gate as the popover run headers (fail-closed). The dialog
  // renders inside the run provider's React tree, so context crosses the
  // portal.
  const {showPeerIdentity} = useRunEditability();
  const composition = provenance.promptComposition;
  const contextParts = [
    composition?.sectionName,
    showPeerIdentity ? provenance.ranByName : undefined,
  ].filter(Boolean) as string[];

  const scalarRows = SCALAR_FIELDS.filter(
    (f) => (f.key !== 'ranByName' || showPeerIdentity) && isPresent(provenance[f.key]),
  );
  const genericKeys = Object.keys(provenance).filter(
    (k) => !SCALAR_KEYS.has(k) && !SUPPRESSED_KEYS.has(k) && isPresent(provenance[k]),
  );

  const tokenCards = [
    {labelKey: 'provenanceTokensPrompt' as const, value: provenance.tokensPrompt},
    {labelKey: 'provenanceTokensCompletion' as const, value: provenance.tokensCompletion},
    {labelKey: 'provenanceTokens' as const, value: provenance.tokensTotal},
  ].filter((c) => isPresent(c.value));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 text-left">
          <DialogTitle className="text-sm font-semibold">
            {t('extraction', 'provenanceToggle')}
          </DialogTitle>
          {contextParts.length > 0 && (
            <DialogDescription className="text-xs text-muted-foreground">
              {contextParts.join(' · ')}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Run parameters */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('extraction', 'generationParamsHeading')}
            </h3>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 @sm:grid-cols-2">
              {scalarRows.map((f) => (
                <ScalarRow
                  key={f.key as string}
                  label={t('extraction', f.labelKey)}
                  value={f.format ? f.format(provenance[f.key]) : String(provenance[f.key])}
                />
              ))}
              {genericKeys.map((k) => (
                <ScalarRow key={k} label={k} value={String(provenance[k])} />
              ))}
            </div>
          </section>

          {/* Prompt composition recipe (structured runs) */}
          {composition ? (
            <section className="space-y-2.5">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('extraction', 'generationCompositionHeading')}
              </h3>
              {isPresent(composition.systemPrompt) && (
                <SystemPromptStep index={1} text={String(composition.systemPrompt)} />
              )}
              {isPresent(composition.sectionInstruction) && (
                <RecipeStep index={2}>
                  <span className="text-xs text-muted-foreground">
                    {t('extraction', 'generationSectionInstruction')}
                  </span>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded border bg-muted/50 p-2 text-[11px] leading-relaxed text-foreground/80">
                    {composition.sectionInstruction}
                  </pre>
                </RecipeStep>
              )}
              <RecipeStep index={3}>
                <div className="rounded-md border border-ai/30 bg-ai/10 px-3 py-2">
                  <div className="text-xs font-medium text-ai">
                    {t('extraction', 'generationArticleInserted')}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ai/90">
                    {isPresent(composition.articleRef?.fileName) && (
                      <span className="min-w-0 truncate">{composition.articleRef?.fileName}</span>
                    )}
                    {isPresent(composition.articleRef?.estTokens) && (
                      <span>
                        {t('extraction', 'generationArticleTokens').replace(
                          '{{n}}',
                          fmtNumber(composition.articleRef?.estTokens),
                        )}
                      </span>
                    )}
                  </div>
                  {composition.articleRef?.truncated && (
                    <div className="mt-1 text-[11px] text-warning">
                      {t('extraction', 'generationArticleTruncated')}
                    </div>
                  )}
                  {articleId && <ArticleTextExpand articleId={articleId} />}
                </div>
              </RecipeStep>
              {(composition.fieldsRequested?.length ?? 0) > 0 && (
                <RecipeStep index={4}>
                  <span className="text-xs text-muted-foreground">
                    {t('extraction', 'generationFieldsRequested').replace(
                      '{{n}}',
                      String(composition.fieldsRequested?.length ?? 0),
                    )}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {composition.fieldsRequested?.map((name) => (
                      <span
                        key={name}
                        className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                  {(composition.llmCalls ?? 0) > 1 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t('extraction', 'generationSplitCalls').replace(
                        '{{n}}',
                        String(composition.llmCalls),
                      )}
                    </div>
                  )}
                </RecipeStep>
              )}
            </section>
          ) : (
            isPresent(provenance.promptText) && (
              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('extraction', 'generationLegacyPrompt')}
                  </h3>
                  <CopyButton value={String(provenance.promptText)} />
                </div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/50 p-2 text-[11px] leading-relaxed text-foreground/80">
                  {provenance.promptText}
                </pre>
              </section>
            )
          )}

          {/* Token totals */}
          {tokenCards.length > 0 && (
            <section className="grid grid-cols-3 gap-2">
              {tokenCards.map((c) => (
                <div key={c.labelKey} className="rounded-md bg-muted/50 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">
                    {t('extraction', c.labelKey)}
                  </div>
                  <div className="text-sm font-medium">{fmtNumber(c.value)}</div>
                </div>
              ))}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * RunProvenanceDisclosure — "how this AI suggestion was generated".
 *
 * Extensible, data-driven transparency surface. A small known-field registry
 * gives labels/formatters/ordering to recognised provenance keys; any other key
 * present on the payload renders as a generic row, so a future backend field
 * (tool calls, seed, reasoning trace) shows up with zero frontend change. Absent
 * keys are omitted (no empty gaps). Long text (the prompt actually sent) renders
 * as a bounded, scrollable code block with copy.
 *
 * Collapsed by default with a one-line `model · N tokens` summary.
 */

import {useState} from 'react';
import {Check, ChevronDown, ChevronRight, Copy} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {useCopyToClipboard} from '@/hooks/useCopyToClipboard';
import type {ExtractionCopy} from '@/lib/copy/extraction';
import type {RunProvenance} from '@/types/ai-extraction';

type ProvenanceKind = 'scalar' | 'code';

interface ProvenanceFieldDef {
  key: keyof RunProvenance;
  labelKey: keyof ExtractionCopy;
  kind: ProvenanceKind;
  format?: (value: unknown) => string;
}

// Ordered registry of recognised fields. Order = render order. Add a row here
// only for presentation niceties (label/format); unrecognised keys still render
// generically below, so the backend can extend `provenance` without touching FE.
const PROVENANCE_REGISTRY: ProvenanceFieldDef[] = [
  {key: 'ranByName', labelKey: 'provenanceRanBy', kind: 'scalar'},
  {key: 'provider', labelKey: 'provenanceProvider', kind: 'scalar'},
  {key: 'model', labelKey: 'provenanceModel', kind: 'scalar'},
  {key: 'reasoning', labelKey: 'provenanceReasoning', kind: 'scalar'},
  {key: 'temperature', labelKey: 'provenanceTemperature', kind: 'scalar'},
  {key: 'outputRetries', labelKey: 'provenanceOutputRetries', kind: 'scalar'},
  {key: 'timeoutSeconds', labelKey: 'provenanceTimeout', kind: 'scalar', format: (v) => `${String(v)}s`},
  {key: 'tokensTotal', labelKey: 'provenanceTokens', kind: 'scalar', format: (v) => Number(v).toLocaleString()},
  {key: 'strategy', labelKey: 'provenanceStrategy', kind: 'scalar'},
  {key: 'promptVersion', labelKey: 'provenancePromptVersion', kind: 'scalar'},
  {key: 'promptText', labelKey: 'provenancePromptSent', kind: 'code'},
];

const REGISTRY_KEYS = new Set<string>(PROVENANCE_REGISTRY.map((f) => f.key as string));
// The raw `ranByUserId` is captured as audit provenance but never shown (a bare
// uuid is not reviewer-facing). The human-readable "Ran by" row uses `ranByName`,
// which the backend resolves from the runner's profile on the history path
// (see extraction_suggestion_read_service._inject_ran_by_names) and the service
// flattens to camelCase. Absent name → the row is simply omitted.
const SUPPRESSED_KEYS = new Set<string>(['ranByUserId']);

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

interface RowProps {
  label: string;
  value: string;
}

function ScalarRow({label, value}: RowProps) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground/90" title={value}>
        {value}
      </span>
    </div>
  );
}

function CodeRow({label, value}: RowProps) {
  const {copied, copy} = useCopyToClipboard();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => copy(value)}
          aria-label={copied ? t('extraction', 'provenanceCopied') : t('extraction', 'provenanceCopyPrompt')}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/60 p-2 text-[11px] leading-relaxed text-foreground/80">
        {value}
      </pre>
    </div>
  );
}

interface RunProvenanceDisclosureProps {
  provenance: RunProvenance;
  defaultOpen?: boolean;
}

export function RunProvenanceDisclosure({provenance, defaultOpen}: RunProvenanceDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  const summaryParts: string[] = [];
  if (isPresent(provenance.model)) summaryParts.push(String(provenance.model));
  if (isPresent(provenance.tokensTotal)) {
    summaryParts.push(
      t('extraction', 'provenanceTokensSummary').replace(
        '{{n}}',
        Number(provenance.tokensTotal).toLocaleString(),
      ),
    );
  }
  const summary = summaryParts.join(' · ');

  // Unrecognised, non-suppressed keys → generic rows (forward-compat).
  const genericKeys = Object.keys(provenance).filter(
    (k) => !REGISTRY_KEYS.has(k) && !SUPPRESSED_KEYS.has(k) && isPresent(provenance[k]),
  );

  return (
    <div className="rounded-md border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-muted-foreground',
          'transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-md',
        )}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span>{t('extraction', 'provenanceToggle')}</span>
        {!open && summary && (
          <span className="ml-auto min-w-0 truncate text-[11px] font-normal text-muted-foreground/80" title={summary}>
            {summary}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 py-2.5">
          {PROVENANCE_REGISTRY.filter((f) => isPresent(provenance[f.key])).map((f) => {
            const raw = provenance[f.key];
            const value = f.format ? f.format(raw) : String(raw);
            const label = t('extraction', f.labelKey);
            return f.kind === 'code' ? (
              <CodeRow key={f.key as string} label={label} value={value} />
            ) : (
              <ScalarRow key={f.key as string} label={label} value={value} />
            );
          })}
          {genericKeys.map((k) => (
            <ScalarRow key={k} label={k} value={String(provenance[k])} />
          ))}
        </div>
      )}
    </div>
  );
}

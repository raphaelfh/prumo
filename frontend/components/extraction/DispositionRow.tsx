/**
 * ADR-0016 disposition chip row — the ONE control that records a coded
 * "no value, on purpose" answer, shared by the extraction form (`FieldInput`)
 * and the consensus override editor (`ConsensusOverrideEditor`).
 *
 * It was two hand-kept copies until PR #729 taught the `allows_no_information`
 * gate to one of them and PR #731 had to retrofit the other, so the rule, the
 * `{value: null, absent_reason}` envelope and the chip styling now live here
 * once. All three codes are per-field opt-ins and render only where the field
 * enables them; `no_information` defaults ON (migration 0062) because it was
 * universal before the flag existed, and is turned off where the answer set
 * already carries the concept as a value — PROBAST+AI's "NI", where rendering
 * both would give one answer two encodings and read as a consensus divergence.
 * Toggling the active chip clears back to unresolved.
 */
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { valueAbsentReason } from '@/lib/extraction/valueSemantics';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

/** The three ADR-0016 opt-in flags. Absent `allows_no_information` ⇒ ON. */
export interface DispositionRowField {
  allows_no_information?: boolean;
  allows_not_applicable?: boolean;
  allows_not_evaluated?: boolean;
}

export interface DispositionRowProps {
  field: DispositionRowField;
  /** Form-shaped value — the active marker is read from it. */
  value: unknown;
  /** Emits `''` to clear, or `{value: null, absent_reason: <code>}` to set. */
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /**
   * Wording for the active state (trailing hint + the active chip's tooltip).
   * Defaults to the extraction form's phrasing; consensus overrides it because
   * there the marker is published as the consensus value.
   */
  activeHint?: string;
}

export function DispositionRow({
  field,
  value,
  onChange,
  disabled,
  activeHint,
}: DispositionRowProps) {
  const activeReason = valueAbsentReason(value);
  const activeText = activeHint ?? t('extraction', 'dispositionActiveHint');

  const dispositions: { code: string; label: string; hint: string }[] = [
    ...(field.allows_no_information !== false
      ? [
          {
            code: 'no_information',
            label: t('extraction', 'dispositionNoInformation'),
            hint: t('extraction', 'dispositionNoInformationHint'),
          },
        ]
      : []),
    ...(field.allows_not_applicable
      ? [
          {
            code: 'not_applicable',
            label: t('extraction', 'dispositionNotApplicable'),
            hint: t('extraction', 'dispositionNotApplicableHint'),
          },
        ]
      : []),
    ...(field.allows_not_evaluated
      ? [
          {
            code: 'not_evaluated',
            label: t('extraction', 'dispositionNotEvaluated'),
            hint: t('extraction', 'dispositionNotEvaluatedHint'),
          },
        ]
      : []),
  ];

  // Nothing to offer and nothing set: render no chrome at all. A marker with no
  // chip left to clear it should not happen (both writers are gated), but if one
  // ever lands the hint still surfaces it rather than leaving the blank input
  // silently "filled".
  if (dispositions.length === 0 && !activeReason) return null;

  const setDisposition = (code: string) =>
    onChange(activeReason === code ? '' : { value: null, absent_reason: code });

  return (
    // Local provider: the row renders on EVERY field, so its tooltips must not
    // depend on a caller-supplied provider.
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-wrap items-center gap-1.5" data-disposition-control>
        {dispositions.map((d) => {
          const active = activeReason === d.code;
          return (
            <Tooltip key={d.code}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => setDisposition(d.code)}
                  className={cn(
                    'gap-1 px-2 text-xs',
                    active
                      ? 'text-success ring-1 ring-inset ring-success bg-success/10 hover:bg-success/15 hover:text-success'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {active ? <Check className="h-3 w-3" /> : null}
                  {d.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{active ? activeText : d.hint}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {activeReason ? (
          <span className="text-[11px] text-muted-foreground">{activeText}</span>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

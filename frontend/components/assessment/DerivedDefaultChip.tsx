/**
 * Derived-default recommendation for an assessor-owned domain judgment
 * (PROBAST+AI v2, spec 2026-08-22 §6).
 *
 * The backend computes the default from the signaling answers
 * (`signaling_worst`); this chip only renders what the payload returns. The
 * breakdown shows each signaling answer in the reviewer's OWN vocabulary
 * (`value`: "PN", a marker label, or not answered) and highlights the rows
 * that caused the default via `contribution === judgment.value` — no
 * answer-mapping knowledge ever lives client-side.
 */

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isOutOfScope,
  OUT_OF_SCOPE,
  toneFor,
} from "@/components/assessment/OverallJudgmentBanner";
import { qa } from "@/lib/copy/qa";
import { cn } from "@/lib/utils";
import type { components } from "@/types/api/schema";

type RunViewDerivedJudgment = components["schemas"]["RunViewDerivedJudgment"];
type RunViewDerivedInput = components["schemas"]["RunViewDerivedInput"];

/**
 * What one breakdown row shows on the right, and in which tone.
 *
 * Plain rows display the RAW stored answer. A collapse group has no single
 * answer (`value` is null by contract on every group row), so it displays its
 * resolved `contribution` instead — and when it resolved to nothing, `state`
 * says which of the two opposite reasons applies. Reading `value ??
 * contribution` alone collapses them into one warning-toned "Not answered",
 * which tells a reviewer whose assessment is COMPLETE that a performance type
 * the study never reported is still owed. Only `"in-progress"` is a gap, so
 * only it is warning-toned; `"unreported"` is muted because there is nothing
 * to act on.
 */
function rowDisplay(input: RunViewDerivedInput): { text: string; tone: string } {
  // First, and muted: out-of-scope outranks the other two by wire contract —
  // there is no work behind it to report as unreported or in progress.
  if (input.state === OUT_OF_SCOPE) {
    return { text: qa.outOfScopeValue, tone: "text-muted-foreground" };
  }
  if (input.state === "unreported") {
    return { text: qa.derivedInputUnreported, tone: "text-muted-foreground" };
  }
  if (input.state === "in-progress") {
    return { text: qa.derivedInputInProgress, tone: "text-warning" };
  }
  const display = input.value ?? input.contribution;
  if (display != null) return { text: display, tone: "text-foreground" };
  return { text: qa.derivedInputNotAnswered, tone: "text-warning" };
}

interface DerivedDefaultChipProps {
  judgment: RunViewDerivedJudgment;
  /** Sets the stored judgment to the derived default via the normal flow. */
  onApply: (value: string) => void;
  disabled?: boolean;
}

export function DerivedDefaultChip({
  judgment,
  onApply,
  disabled = false,
}: DerivedDefaultChipProps) {
  const [open, setOpen] = useState(false);
  const derived = judgment.value ?? null;
  const inputs = judgment.inputs ?? [];
  // A domain with no applicable signaling questions has no default to derive,
  // which is not the same as "not every question has been answered yet".
  const blank = isOutOfScope(inputs)
    ? { text: qa.outOfScopeValue, hint: qa.outOfScopeHint }
    : { text: qa.derivedDefaultIncomplete, hint: qa.derivedDefaultIncompleteHint };

  return (
    <div className="mb-2" data-testid={`qa-derived-${judgment.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {qa.derivedDefaultLabel}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn("gap-1 font-normal", toneFor(derived))}
              data-testid={`qa-derived-chip-${judgment.id}`}
            >
              <span className="font-semibold">{derived ?? blank.text}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {derived ? qa.derivedExplainShow : blank.hint}
          </TooltipContent>
        </Tooltip>
        {derived !== null && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => onApply(derived)}
            data-testid={`qa-derived-apply-${judgment.id}`}
          >
            {qa.derivedDefaultApply}
          </Button>
        ) : null}
      </div>

      {inputs.length > 0 ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            className="mt-1 flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`qa-derived-explain-toggle-${judgment.id}`}
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
            {qa.derivedExplainShow}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1">
            <ul className="space-y-0.5">
              {inputs.map((input) => {
                const causes =
                  derived !== null && input.contribution === derived;
                const { text, tone } = rowDisplay(input);
                return (
                  <li
                    key={input.label}
                    className={cn(
                      "flex items-baseline justify-between gap-3 rounded-sm px-1 text-[11px] leading-5",
                      causes && "bg-muted font-medium",
                    )}
                    data-testid={`qa-derived-input-row-${judgment.id}`}
                    data-causes={causes ? "true" : "false"}
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {input.label}
                    </span>
                    <span className={cn("shrink-0", tone)}>{text}</span>
                  </li>
                );
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/**
 * Read-only banner for a quality-assessment template's computed overalls.
 *
 * PROBAST+AI defines its four overall judgments as a deterministic function of
 * the domain judgments, so they are never stored and never typed — the backend
 * (`derived_judgment_service`) is the single implementation and this component
 * only renders what it returns. An incomplete overall renders as an em dash,
 * never as the most favourable judgment: one does not conclude low risk from an
 * unfinished assessment.
 *
 * The disclosure exists because that em dash used to be a dead end. With
 * sixteen domain judgments across ten sections, "why is this blank?" had no
 * answer on screen, and a reviewer who blanked one judgment could re-enter
 * values all day without learning which one was withholding the overall. The
 * per-domain breakdown comes from the SAME computation as the value itself
 * (`derived_judgments[].inputs`), so the explanation can never narrate a rule
 * the backend did not apply.
 */

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";
import { cn } from "@/lib/utils";

interface DerivedJudgmentInputView {
  label: string;
  value: string | null;
  /** The judgment the rule consumed from this row; null when it consumed none. */
  contribution?: string | null;
  /**
   * Why a collapse-group row contributed nothing — `"unreported"` or
   * `"in-progress"`. Set by the backend only on group rows, and never
   * alongside `contribution`.
   */
  state?: string | null;
}

export interface DerivedJudgmentView {
  id: string;
  label: string;
  value: string | null;
  inputs?: DerivedJudgmentInputView[];
}

interface OverallJudgmentBannerProps {
  judgments: DerivedJudgmentView[];
}

function toneFor(value: string | null): string {
  switch (value?.toLowerCase()) {
    case "high":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "unclear":
      return "border-warning/40 bg-warning/10 text-warning";
    case "low":
      return "border-success/40 bg-success/10 text-success";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/**
 * What one breakdown row shows on the right, and in which tone.
 *
 * A collapse group (Evaluation D4's performance types) has no single stored
 * answer, so `value` is null on every group row — judged or not. Reading only
 * `value` therefore labelled ALL of them "Not judged", including groups that
 * contributed a judgment, and warning-toned a study that had simply never done
 * external validation. `contribution` supplies the judgment; `state` separates
 * the two ways a group can contribute nothing, and only `"in-progress"` is a
 * gap the reviewer can close — so only it is warning-toned.
 */
function rowDisplay(input: DerivedJudgmentInputView): { text: string; tone: string } {
  if (input.state === "unreported") {
    return { text: qa.overallExplainInputUnreported, tone: "text-muted-foreground" };
  }
  if (input.state === "in-progress") {
    return { text: qa.overallExplainInputInProgress, tone: "text-warning" };
  }
  const judged = input.value ?? input.contribution;
  if (judged != null) return { text: judged, tone: "text-foreground" };
  return { text: qa.overallExplainInputNotJudged, tone: "text-warning" };
}

/** One overall's contributing domains, so a dash can be traced to its cause. */
function InputBreakdown({ judgment }: { judgment: DerivedJudgmentView }) {
  const inputs = judgment.inputs ?? [];
  if (inputs.length === 0) return null;

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium text-foreground">{judgment.label}</p>
      <ul className="space-y-0.5">
        {inputs.map((input) => {
          const { text, tone } = rowDisplay(input);
          return (
            <li
              key={input.label}
              className="flex items-baseline justify-between gap-3 text-[11px] leading-5"
            >
              <span className="min-w-0 truncate text-muted-foreground">{input.label}</span>
              <span className={cn("shrink-0 font-medium", tone)}>{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function OverallJudgmentBanner({ judgments }: OverallJudgmentBannerProps) {
  const [open, setOpen] = useState(false);

  if (judgments.length === 0) return null;

  const anyIncomplete = judgments.some((judgment) => judgment.value === null);
  const explainable = judgments.some((judgment) => (judgment.inputs?.length ?? 0) > 0);

  return (
    <section
      className="mb-3 rounded-md border bg-card p-3"
      data-testid="qa-overall-banner"
      aria-label={qa.overallBannerTitle}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {qa.overallBannerTitle}
        </h2>
        <span className="text-[11px] text-muted-foreground">{qa.overallBannerHint}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {judgments.map((judgment) => (
          <li key={judgment.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn("gap-2 font-normal", toneFor(judgment.value))}
                  data-testid={`qa-overall-${judgment.id}`}
                >
                  <span className="text-muted-foreground">{judgment.label}</span>
                  <span className="font-semibold">{judgment.value ?? qa.overallIncomplete}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {judgment.value ? qa.overallBannerHint : qa.overallIncompleteHint}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>

      {explainable && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            className="mt-2 flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="qa-overall-explain-toggle"
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
            {open ? qa.overallExplainHide : qa.overallExplainShow}
          </CollapsibleTrigger>
          <CollapsibleContent
            className="mt-2 border-t pt-2 text-[11px] leading-5 text-muted-foreground"
            data-testid="qa-overall-explain"
          >
            <p>{qa.overallExplainRule}</p>
            {anyIncomplete && <p className="mt-1">{qa.overallExplainIncomplete}</p>}
            <p className="mt-1">{qa.overallExplainNoInformation}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {judgments.map((judgment) => (
                <InputBreakdown key={judgment.id} judgment={judgment} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

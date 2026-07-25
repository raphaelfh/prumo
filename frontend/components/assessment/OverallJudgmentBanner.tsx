/**
 * Read-only banner for a quality-assessment template's computed overalls.
 *
 * PROBAST+AI defines its four overall judgments as a deterministic function of
 * the domain judgments, so they are never stored and never typed — the backend
 * (`derived_judgment_service`) is the single implementation and this component
 * only renders what it returns. An incomplete overall renders as an em dash,
 * never as the most favourable judgment: one does not conclude low risk from an
 * unfinished assessment.
 */

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";
import { cn } from "@/lib/utils";

export interface DerivedJudgmentView {
  id: string;
  label: string;
  value: string | null;
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

export function OverallJudgmentBanner({ judgments }: OverallJudgmentBannerProps) {
  if (judgments.length === 0) return null;

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
    </section>
  );
}

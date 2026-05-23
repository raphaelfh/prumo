/**
 * Compact "X/N reviewers" badge for the run header.
 *
 * Renders progress against the run's HitlConfigSnapshot reviewer_count
 * with an `aria-label` that screen readers can interpret. Color tracks
 * completion: amber (incomplete), emerald (complete), slate (single
 * reviewer / N=1).
 */

import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ReviewerProgressBadgeProps {
  reviewerCount: number;
  requiredReviewerCount: number;
  divergentCount?: number;
}

export function ReviewerProgressBadge({
  reviewerCount,
  requiredReviewerCount,
  divergentCount = 0,
}: ReviewerProgressBadgeProps) {
  const complete = reviewerCount >= requiredReviewerCount;
  const single = requiredReviewerCount <= 1;

  const colorClass = single
    ? "border-border/60 bg-muted/40 text-muted-foreground"
    : complete
      ? "border-success/30 bg-success/10 text-success"
      : "border-warning/30 bg-warning/10 text-warning";

  const label = `${reviewerCount}/${requiredReviewerCount} reviewer${
    requiredReviewerCount === 1 ? "" : "s"
  }`;
  const tooltipParts = [
    `${reviewerCount} of ${requiredReviewerCount} reviewer${
      requiredReviewerCount === 1 ? "" : "s"
    } have written at least one decision in this run.`,
  ];
  if (divergentCount > 0) {
    tooltipParts.push(
      `${divergentCount} field${divergentCount === 1 ? "" : "s"} need consensus.`,
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("gap-1", colorClass)}
            data-testid="reviewer-progress-badge"
            aria-label={label}
          >
            <Users className="h-3 w-3" />
            <span>{label}</span>
            {divergentCount > 0 ? (
              <span
                className="ml-1 rounded bg-warning/20 px-1 text-[10px] font-semibold text-warning"
                data-testid="reviewer-progress-divergence"
              >
                {divergentCount} ⚠
              </span>
            ) : null}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            {tooltipParts.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

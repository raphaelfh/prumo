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
    ? "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    : complete
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";

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
                className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-700 dark:text-amber-200"
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

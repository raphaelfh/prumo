/**
 * Shared HITL status badges + reopen affordance.
 *
 * Both `ExtractionFullScreen` and `QualityAssessmentFullScreen` had
 * grown their own copies of the same badge cluster (Published,
 * Revision) plus a "Reopen for revision" button. This component
 * collapses those into a single primitive parameterized by `kind` so
 * the two pages stay visually + behaviorally aligned.
 *
 * The `kind` prop only changes the `data-testid` prefixes so existing
 * E2E tests (`qa-revision-badge`, `extraction-revision-badge`, …)
 * keep matching without renaming. The visual treatment is identical
 * across kinds — divergence here would be a regression, not a feature.
 */

import { CheckCircle2, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type HITLBadgeKind = "extraction" | "qa";

interface HITLStatusBadgesProps {
  kind: HITLBadgeKind;
  /** Show the green "Published" badge — typically `run.stage === 'finalized'`. */
  finalized: boolean;
  /** When set, render the blue "Revision" badge with the parent ref. */
  parentRunId?: string | null;
}

interface HITLReopenButtonProps {
  kind: HITLBadgeKind;
  visible: boolean;
  onClick: () => void;
  disabled?: boolean;
  reopening: boolean;
}

export function HITLStatusBadges({
  kind,
  finalized,
  parentRunId,
}: HITLStatusBadgesProps) {
  return (
    <>
      {finalized ? (
        <Badge
          variant="outline"
          className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          data-testid={`${kind}-finalized-badge`}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Published
        </Badge>
      ) : null}
      {parentRunId ? (
        <Badge
          variant="outline"
          className="border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200"
          data-testid={`${kind}-revision-badge`}
          title={`Derived from run ${parentRunId}`}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Revision
        </Badge>
      ) : null}
    </>
  );
}

export function HITLReopenButton({
  kind,
  visible,
  onClick,
  disabled = false,
  reopening,
}: HITLReopenButtonProps) {
  if (!visible) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled || reopening}
      data-testid={`${kind}-reopen-button`}
    >
      <RotateCcw className="mr-1 h-3 w-3" />
      {reopening ? "Reopening…" : "Reopen for revision"}
    </Button>
  );
}

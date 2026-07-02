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
import { t } from "@/lib/copy";

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
          className="border-success/30 bg-success/10 text-success"
          data-testid={`${kind}-finalized-badge`}
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          {t("runs", "published")}
        </Badge>
      ) : null}
      {parentRunId ? (
        <Badge
          variant="outline"
          className="border-info/30 bg-info/10 text-info"
          data-testid={`${kind}-revision-badge`}
          title={t("runs", "revisionDerivedFrom")}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          {t("runs", "revision")}
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
      {reopening ? t("runs", "reopening") : t("runs", "reopenForRevision")}
    </Button>
  );
}

interface HITLPublishedBannerProps {
  kind: HITLBadgeKind;
  finalized: boolean;
  parentRunId?: string | null;
  /** Gate for the inline Reopen button (e.g. extraction's canReopen). */
  showReopen?: boolean;
  onReopen: () => void;
  reopening: boolean;
}

/**
 * Sub-header banner between RunHeader and the panels: status badges plus,
 * on a published run, the read-only notice and an inline Reopen button
 * (spec 2026-07-02 D4). Shared verbatim by both session screens.
 */
export function HITLPublishedBanner({
  kind,
  finalized,
  parentRunId,
  showReopen = true,
  onReopen,
  reopening,
}: HITLPublishedBannerProps) {
  if (!finalized && !parentRunId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
      <HITLStatusBadges kind={kind} finalized={finalized} parentRunId={parentRunId} />
      {finalized && (
        <>
          <span className="text-muted-foreground">
            {t("runs", "publishedReadOnlyNotice")}
          </span>
          <HITLReopenButton
            kind={kind}
            visible={showReopen}
            onClick={onReopen}
            reopening={reopening}
          />
        </>
      )}
    </div>
  );
}

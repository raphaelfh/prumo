/**
 * Configuration tab for the Quality Assessment landing page.
 *
 * Lists every global QA template (PROBAST, QUADAS-2, future tools) and
 * lets the user enable each one independently for the project. Multi-select
 * is the whole point — a project can run PROBAST AND QUADAS-2 in parallel,
 * with the active-template bar above the article table letting reviewers
 * switch between them while assessing.
 *
 * Toggle ON → ``POST /api/v1/projects/:id/templates/clone``: clones the
 * global template into ``project_extraction_templates`` (idempotent;
 * a second toggle on after a toggle off just flips ``is_active`` back).
 * Toggle OFF → ``PATCH /api/v1/projects/:id/templates/:tid``: sets
 * ``is_active=false``. Historical Runs survive untouched — re-enabling
 * the tool brings it back to the article table without losing work.
 */

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/copy";
import {
  useHITLProjectTemplates,
  type GlobalTemplate,
  type ProjectTemplate,
} from "@/hooks/hitl/useHITLProjectTemplates";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { ManagerReviewVisibilityToggle } from "@/components/runs/ManagerReviewVisibilityToggle";
import { TemplateInstructionControl } from "@/components/extraction/TemplateInstructionControl";
import { TemplateConfigPublishControls } from "@/components/extraction/template-config/TemplateConfigPublishControls";

interface Props {
  projectId: string;
}

export function QualityAssessmentConfiguration({ projectId }: Props) {
  const {
    templates,
    globalTemplates,
    loading,
    error,
    cloneTemplate,
    setTemplateActive,
    isTemplateImported,
  } = useHITLProjectTemplates({
    projectId,
    kind: "quality_assessment",
    includeInactive: true,
  });

  const [pendingId, setPendingId] = useState<string | null>(null);
  // Keyed by template id and owned HERE, not per row: N enabled tools could
  // each open a diff sheet, and two stacked modal sheets trap focus.
  const [diffSheetFor, setDiffSheetFor] = useState<string | null>(null);

  // Per-kind manager review-visibility (blind toggle). Manager-only; for a
  // manager `canSeeOthers` mirrors the persisted
  // `managers_see_reviewers.quality_assessment` value.
  const { userId } = useCurrentUser();
  const permissions = useComparisonPermissions(
    projectId,
    userId ?? "",
    "quality_assessment",
  );

  const enabledCount = templates.filter((tpl) => tpl.is_active).length;

  const findInactiveClone = (
    globalTemplateId: string,
  ): ProjectTemplate | undefined =>
    templates.find(
      (tpl) =>
        tpl.global_template_id === globalTemplateId && tpl.is_active === false,
    );

  // Hoisted out of `toggle`, which used to compute it inline: the row now needs
  // the same id to mount the instruction and publish controls, and two copies
  // of an "active clone" predicate is how they drift.
  const findActiveClone = (
    globalTemplateId: string,
  ): ProjectTemplate | undefined =>
    templates.find(
      (tpl) =>
        tpl.global_template_id === globalTemplateId && tpl.is_active === true,
    );

  const toggle = (global: GlobalTemplate, nextEnabled: boolean) => {
    setPendingId(global.id);
    const doToggle = async () => {
      if (nextEnabled) {
        const inactiveClone = findInactiveClone(global.id);
        if (inactiveClone) {
          await setTemplateActive(inactiveClone.id, true);
        } else {
          await cloneTemplate(global.id);
        }
      } else {
        const active = findActiveClone(global.id);
        if (active) {
          await setTemplateActive(active.id, false);
        }
      }
    };
    void doToggle().finally(() => setPendingId(null));
  };

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            {t("qa", "configHeader")}
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="hitl-quality_assessment-configuration">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {t("qa", "configHeader")}
            </CardTitle>
            <CardDescription>{t("qa", "configurationDesc")}</CardDescription>
          </div>
          <span className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t("qa", "configCountFormat")
              .replace("{{enabled}}", String(enabledCount))
              .replace("{{total}}", String(globalTemplates.length))}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : globalTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("qa", "configEmptyGlobals")}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {globalTemplates.map((global) => {
              const enabled = isTemplateImported(global.id);
              const isPending = pendingId === global.id;
              const activeClone = findActiveClone(global.id);
              return (
                <li
                  key={global.id}
                  className="py-3"
                  data-testid={`hitl-quality_assessment-config-row-${global.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-warning" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {global.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          v{global.version}
                        </span>
                      </div>
                      {global.description ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {global.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : null}
                    <Switch
                      checked={enabled}
                      onCheckedChange={(value) => toggle(global, value)}
                      disabled={isPending}
                      aria-label={`${enabled ? t("qa", "configToggleDisable") : t("qa", "configToggleEnable")} ${global.name}`}
                      data-testid={`hitl-quality_assessment-config-toggle-${global.id}`}
                    />
                  </div>
                  </div>
                  {enabled && activeClone ? (
                    // The instruction is what PROBAST+AI's applicability items
                    // are judged against, and until now QA had no editor for it
                    // anywhere — the ✨ control mounts inside the extraction
                    // Configuration tab, whose template list filters to
                    // `kind: 'extraction'`. Both controls are kind-agnostic
                    // (`{projectId, templateId}` and no kind predicate behind
                    // them), so they mount here unchanged.
                    //
                    // Export/Import are deliberately NOT mounted: they are the
                    // only publish-family endpoints hard-gated to extraction
                    // (`to_portable` 404s on a QA id, `parse_portable_document`
                    // 422s).
                    <div
                      className="mt-2 flex flex-wrap items-center gap-2 pl-7"
                      data-testid={`hitl-quality_assessment-config-controls-${global.id}`}
                    >
                      <TemplateInstructionControl
                        projectId={projectId}
                        templateId={activeClone.id}
                      />
                      <TemplateConfigPublishControls
                        projectId={projectId}
                        templateId={activeClone.id}
                        diffSheetOpen={diffSheetFor === activeClone.id}
                        onDiffSheetOpenChange={(open) =>
                          setDiffSheetFor(open ? activeClone.id : null)
                        }
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {permissions.loading ? null : (
          <div className="mt-4 border-t border-border/40 pt-4">
            <div className="mb-2">
              <p className="text-sm font-medium">
                {t("qa", "managerVisibilitySectionTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("qa", "managerVisibilitySectionDesc")}
              </p>
            </div>
            <ManagerReviewVisibilityToggle
              projectId={projectId}
              kind="quality_assessment"
              currentValue={permissions.canSeeOthers}
              disabled={!permissions.canManageBlindMode}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

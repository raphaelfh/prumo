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

import { useMemo, useState } from "react";
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

interface Props {
  projectId: string;
  onAfterChange?: () => void;
}

export function QualityAssessmentConfiguration({
  projectId,
  onAfterChange,
}: Props) {
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

  const enabledCount = useMemo(
    () => templates.filter((tpl) => tpl.is_active).length,
    [templates],
  );

  const findInactiveClone = (
    globalTemplateId: string,
  ): ProjectTemplate | undefined =>
    templates.find(
      (tpl) =>
        tpl.global_template_id === globalTemplateId && tpl.is_active === false,
    );

  const toggle = async (global: GlobalTemplate, nextEnabled: boolean) => {
    setPendingId(global.id);
    try {
      if (nextEnabled) {
        const inactiveClone = findInactiveClone(global.id);
        if (inactiveClone) {
          await setTemplateActive(inactiveClone.id, true);
        } else {
          await cloneTemplate(global.id);
        }
      } else {
        const active = templates.find(
          (tpl) =>
            tpl.global_template_id === global.id && tpl.is_active === true,
        );
        if (active) {
          await setTemplateActive(active.id, false);
        }
      }
      onAfterChange?.();
    } finally {
      setPendingId(null);
    }
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
              return (
                <li
                  key={global.id}
                  className="flex items-center justify-between gap-3 py-3"
                  data-testid={`hitl-quality_assessment-config-row-${global.id}`}
                >
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 text-amber-600" />
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
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

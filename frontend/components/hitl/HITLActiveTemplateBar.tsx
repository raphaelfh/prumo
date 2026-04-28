/**
 * Mini-header above the article table that shows which template the
 * table is currently displaying and (when more than one is enabled)
 * lets the user switch between them.
 *
 * The selection lives in a ``?template=<uuid>`` URL query param so a
 * page reload keeps the view. Both extraction and quality assessment
 * mount this bar — extraction usually collapses to a static label
 * because it has a single active template per project, while QA can
 * toggle between PROBAST and QUADAS-2 on the fly.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/lib/copy";
import type {
  HITLKind,
  ProjectTemplate,
} from "@/hooks/hitl/useHITLProjectTemplates";

interface Props {
  kind: HITLKind;
  templates: ProjectTemplate[];
  activeTemplate: ProjectTemplate | null;
  onSelect: (templateId: string) => void;
  emptyHint?: string;
}

export function HITLActiveTemplateBar({
  kind,
  templates,
  activeTemplate,
  onSelect,
  emptyHint,
}: Props) {
  const Icon = kind === "quality_assessment" ? ShieldCheck : Sparkles;
  const iconColor =
    kind === "quality_assessment" ? "text-amber-600" : "text-blue-600";

  if (templates.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid={`hitl-${kind}-active-template-bar-empty`}
      >
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <span>{emptyHint ?? t("qa", "activeTemplateNone")}</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-card/50 px-3 py-2 text-sm"
      data-testid={`hitl-${kind}-active-template-bar`}
    >
      <Icon className={`h-4 w-4 ${iconColor}`} />
      <span className="text-muted-foreground">
        {kind === "quality_assessment"
          ? t("qa", "activeTemplateLabel")
          : "Active template:"}
      </span>
      {templates.length === 1 ? (
        <span
          className="font-medium"
          data-testid={`hitl-${kind}-active-template-name`}
        >
          {activeTemplate?.name ?? templates[0].name}
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              data-testid={`hitl-${kind}-active-template-trigger`}
            >
              <span className="font-medium">
                {activeTemplate?.name ?? templates[0].name}
              </span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {templates.map((tpl) => (
              <DropdownMenuItem
                key={tpl.id}
                onSelect={() => onSelect(tpl.id)}
                data-testid={`hitl-${kind}-active-template-option-${tpl.id}`}
              >
                <Icon className={`mr-2 h-3.5 w-3.5 ${iconColor}`} />
                <span className="text-sm">{tpl.name}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">
                  v{tpl.version}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Resolve the active template id from the URL ``?template=`` param,
 * falling back to the first imported template, and expose a setter
 * that updates the param without triggering a navigation.
 */
export function useActiveTemplateSelection(
  templates: ProjectTemplate[],
): {
  activeTemplate: ProjectTemplate | null;
  selectTemplate: (templateId: string) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTemplate = useMemo<ProjectTemplate | null>(() => {
    if (templates.length === 0) return null;
    const fromUrl = searchParams.get("template");
    if (fromUrl) {
      const match = templates.find((tpl) => tpl.id === fromUrl);
      if (match) return match;
    }
    return templates[0];
  }, [searchParams, templates]);

  const selectTemplate = useCallback(
    (templateId: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("template", templateId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return { activeTemplate, selectTemplate };
}

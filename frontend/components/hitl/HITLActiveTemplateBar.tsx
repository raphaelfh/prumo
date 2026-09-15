/**
 * The Quality-assessment list's Active tool control: which tool the article
 * table shows and, when more than one is enabled, a menu to switch. It sits
 * in the list toolbar, left of search (``HITLArticleTable``'s
 * ``toolbarLeading`` slot).
 *
 * The selection lives in a ``?template=<uuid>`` URL query param so a page
 * reload keeps the view. With no tool enabled it renders the dashed hint
 * instead.
 *
 * The "Active tool:" label folds to ``sr-only`` when the toolbar
 * (``@container/listbar``) is narrow, so the accessible name always reads
 * "Active tool: <name>". The name truncates; its tooltip carries it whole.
 */

import { useSearchParams } from "react-router";
import { ChevronDown, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/lib/copy";
import type { ProjectTemplate } from "@/hooks/hitl/useHITLProjectTemplates";

interface Props {
  templates: ProjectTemplate[];
  activeTemplate: ProjectTemplate | null;
  onSelect: (templateId: string) => void;
}

const TEST_ID = "hitl-quality_assessment-active-template";

export function HITLActiveTemplateBar({ templates, activeTemplate, onSelect }: Props) {
  if (templates.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid={`${TEST_ID}-bar-empty`}
      >
        <ShieldCheck className="h-4 w-4 text-warning" />
        <span>{t("qa", "activeTemplateNone")}</span>
      </div>
    );
  }

  const name = activeTemplate?.name ?? templates[0].name;
  const content = (
    <>
      <ShieldCheck className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="sr-only @[48rem]/listbar:not-sr-only text-muted-foreground">
        {t("qa", "activeTemplateLabel")}
      </span>{" "}
      <span className="min-w-0 truncate font-medium" data-testid={`${TEST_ID}-name`}>
        {name}
      </span>
    </>
  );

  return (
    <div
      className="flex min-w-0 max-w-[50%] items-center md:max-w-xs"
      data-testid={`${TEST_ID}-bar`}
    >
      {templates.length === 1 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 items-center gap-1.5 px-2 text-[13px]">{content}</div>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 max-w-full gap-1.5 text-[13px]"
                  data-testid={`${TEST_ID}-trigger`}
                >
                  {content}
                  <ChevronDown className="shrink-0" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            {templates.map((tpl) => (
              <DropdownMenuItem
                key={tpl.id}
                onSelect={() => onSelect(tpl.id)}
                data-testid={`${TEST_ID}-option-${tpl.id}`}
              >
                <ShieldCheck className="mr-2 h-3.5 w-3.5 text-warning" />
                <span className="text-sm">{tpl.name}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">v{tpl.version}</span>
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

  const fromUrl = searchParams.get("template");
  const activeTemplate: ProjectTemplate | null =
    templates.length === 0
      ? null
      : (fromUrl ? templates.find((tpl) => tpl.id === fromUrl) : undefined) ?? templates[0];

  const selectTemplate = (templateId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("template", templateId);
    setSearchParams(next, { replace: true });
  };

  return { activeTemplate, selectTemplate };
}

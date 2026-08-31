/**
 * The ⚙ extraction-engine chip (§5, C1b T6; slice C).
 *
 * Page chrome of the Configuration tab — project regime, OUTSIDE the
 * versioned template card: choosing an engine never arms the Draft chip and
 * never appears in the Publish diff.
 *
 * The picker itself is `LlmEnginePane`, mounted as the "Model" tab of
 * `AiConfigDialog` — the same popup that carries the review question and the
 * general AI instruction. One surface for everything the AI is configured
 * with, instead of the three (dialog, popover, popover) this replaced.
 *
 * On a failed read the chip renders NOTHING and the rest of the tab is
 * unaffected — the deploy-race window where a new frontend hits an old
 * backend without the route.
 */
import { useState } from "react";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AiConfigDialog } from "@/components/project/AiConfigDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLlmEngine } from "@/hooks/extraction/useLlmEngine";
import { t } from "@/lib/copy";

interface LlmEngineChipProps {
  projectId: string;
  /** Present only when the chip rides IN a template's config bar: the dialog
   * it opens then also carries that template's instruction tab. */
  templateId?: string;
}

export function LlmEngineChip({ projectId, templateId }: LlmEngineChipProps) {
  const [open, setOpen] = useState(false);
  // The instruction tab's parked draft — held here so it survives the dialog
  // closing (see TemplateInstructionPane).
  const [instructionDraft, setInstructionDraft] = useState<string | null>(null);
  const query = useLlmEngine(projectId);

  // Pending AND error both render nothing — the chrome ROW included, so the
  // Configuration tab never shows an empty flex strip: the chip is optional
  // chrome, never a blocker for the tab (deploy-race 404 window included).
  const engine = query.data;
  if (!engine) return null;

  const currentEntry = engine.catalog.find(
    (e) => e.provider === engine.provider && e.model === engine.model,
  );
  // An endpoint engine has no catalogue entry to borrow a label from: it
  // reads as "<model> · <endpoint>", from the read's scalar label.
  const chipLabel =
    engine.endpoint_id && engine.endpoint_label
      ? `${engine.model} · ${engine.endpoint_label}`
      : (currentEntry?.label ?? engine.model);

  return (
    <div className="flex items-center justify-end">
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-[13px] font-normal text-muted-foreground hover:text-foreground"
              aria-label={t("llmEngine", "chipAria")}
              data-testid="llm-engine-chip"
              onClick={() => setOpen(true)}
            >
              <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              {/* Container queries against the config bar this chip is
                  composed into (2026-08-29). They are MAX-width, so they are
                  inert wherever no `configbar` container exists — the
                  standalone no-template placement keeps the full label. The
                  gear, the aria-label and the tooltip survive every rung, so
                  nothing becomes unidentifiable. */}
              <span className="max-w-[16rem] truncate font-medium text-foreground @max-[40rem]/configbar:hidden">
                {chipLabel}
              </span>
              <span aria-hidden="true" className="@max-[52rem]/configbar:hidden">
                ·
              </span>
              <span className="@max-[52rem]/configbar:hidden">
                {t(
                  "llmEngine",
                  engine.mode === "verified" ? "modeVerified" : "modeFast",
                )}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("llmEngine", "chipTooltip")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AiConfigDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        initialTab="model"
        withModel
        template={
          templateId
            ? {
                id: templateId,
                instructionDraft,
                onInstructionDraftChange: setInstructionDraft,
              }
            : undefined
        }
      />
    </div>
  );
}

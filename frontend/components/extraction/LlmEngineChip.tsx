/**
 * The ⚙ AI-configuration chip (§5, C1b T6; slice C).
 *
 * Page chrome of the Configuration tab — project regime, OUTSIDE the
 * versioned template card: choosing an engine never arms the Draft chip and
 * never appears in the Publish diff.
 *
 * It is the config bar's ONLY entry into `AiConfigDialog`. The bar used to
 * carry three triggers — this chip, the review-question chip and the ✨
 * instruction button — that all opened the SAME dialog on different tabs,
 * which is both a repeated control and three chips' worth of width on a bar
 * that already overflowed. The dialog's tab strip is the picker now; the bar
 * shows the model that runs, and one amber count when the template's
 * instruction still has `[customize:]` slots nobody filled in — the single
 * piece of state on the other tabs that is a WARNING rather than a setting,
 * and the only one worth the pixels outside the dialog.
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
import { useTemplateInstruction } from "@/hooks/extraction/useTemplateInstruction";
import { t } from "@/lib/copy";

const CUSTOMIZE_SLOT = /\[customize:[^\]]*\]/g;

/** The amber "still to customize" count, INSIDE the chip's button so it joins
 * the trigger's accessible name. Its own component, not an inline branch: the
 * read only exists when a template is on screen, and a hook cannot be called
 * conditionally — the standalone chip must not fire (or even require) this
 * query. */
function InstructionWarning({
  projectId,
  templateId,
}: {
  projectId: string;
  templateId: string;
}) {
  // Deduped into one request with the dialog's observer and the publish
  // controls' — same query key.
  const { data } = useTemplateInstruction(projectId, templateId);
  const slots = (
    data?.llm_template_instruction?.match(CUSTOMIZE_SLOT) ?? []
  ).length;
  if (slots === 0) return null;

  // A span, not a Badge: Badge renders a <div>, and a <button> only admits
  // phrasing content. The digit is the whole visible chip — the sentence
  // that explains it stays in the accessible name, where it costs no width.
  return (
    <span
      data-testid="instruction-customize-chip"
      className="shrink-0 rounded-full border border-warning/50 bg-warning/10 px-1.5 text-[11px] text-warning"
    >
      <span aria-hidden>{String(slots)}</span>
      <span className="sr-only">
        {t("extraction", "instructionCustomizeChip").replace(
          "{{n}}",
          String(slots),
        )}
      </span>
    </span>
  );
}

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
              data-testid="llm-engine-chip"
              onClick={() => setOpen(true)}
            >
              <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              {/* No aria-label anywhere on this button: it would REPLACE the
                  composed name and erase the amber warning below for exactly
                  the users who cannot see it. What the control IS gets said
                  here instead, always in the accessibility tree and never in
                  pixels — the visible label is the model it runs. */}
              <span className="sr-only">
                {t("aiContext", "configDialogTitle")}
              </span>
              {/* Container queries against the config bar this chip is
                  composed into (2026-08-29). They are MAX-width, so they are
                  inert wherever no `configbar` container exists — the
                  standalone no-template placement keeps the full label. Parts
                  fold to `sr-only`, never to `hidden`: `hidden` would drop the
                  model out of the button's name as the bar narrows. */}
              <span className="max-w-[16rem] truncate font-medium text-foreground @max-[40rem]/configbar:sr-only">
                {chipLabel}
              </span>
              <span aria-hidden="true" className="@max-[52rem]/configbar:hidden">
                ·
              </span>
              <span className="@max-[52rem]/configbar:sr-only">
                {t(
                  "llmEngine",
                  engine.mode === "verified" ? "modeVerified" : "modeFast",
                )}
              </span>
              {templateId && (
                <InstructionWarning
                  projectId={projectId}
                  templateId={templateId}
                />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("aiContext", "configDialogDesc")}
          </TooltipContent>
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

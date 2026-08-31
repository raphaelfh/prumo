import { useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AiConfigDialog } from "@/components/project/AiConfigDialog";
import { useTemplateInstruction } from "@/hooks/extraction/useTemplateInstruction";
import { t } from "@/lib/copy";
import { cn } from "@/lib/utils";

const CUSTOMIZE_SLOT = /\[customize:[^\]]*\]/g;

function customizeSlotCount(value: string | null | undefined): number {
  return value ? (value.match(CUSTOMIZE_SLOT) ?? []).length : 0;
}

interface TemplateInstructionControlProps {
  projectId: string;
  templateId: string;
}

/**
 * The config bar's ✨ trigger for the template-level general AI instruction.
 * The editing surface itself is `AiConfigDialog` (opened on its instruction
 * tab), shared with the review-question chip — one popup for everything the
 * AI is told, instead of the popover this used to carry.
 *
 * What stays here is what a manager decides on at a glance: is an
 * instruction set, and does it still carry unfilled `[customize:]` slots.
 * Both live in the trigger's ACCESSIBLE NAME, never behind an `aria-label` —
 * an aria-label would replace the composed content and erase the warning for
 * exactly the users who cannot see the amber chip.
 *
 * The draft deliberately lives HERE and not inside the dialog: Radix
 * unmounts dialog content on close, so a draft owned by the surface would
 * be silently destroyed by a stray Escape or overlay click. Dismissing
 * keeps the text and the trigger says so; only Cancel discards.
 */
export function TemplateInstructionControl({
  projectId,
  templateId,
}: TemplateInstructionControlProps) {
  const { data, isLoading } = useTemplateInstruction(projectId, templateId);
  const [open, setOpen] = useState(false);
  // null = never edited this session; a string = a draft the manager owns.
  const [draft, setDraft] = useState<string | null>(null);

  if (isLoading || !data) {
    return <Skeleton className="h-7 w-24 shrink-0 rounded-md" />;
  }

  const value = data.llm_template_instruction ?? "";
  const slotCount = customizeSlotCount(data.llm_template_instruction);
  const unsaved = draft !== null && draft !== value;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Sparkles
              className={cn("shrink-0", value !== "" && "text-foreground")}
              strokeWidth={1.5}
              aria-hidden
            />
            {/* Never `hidden`: the label is the trigger's name at every width,
            it only stops taking pixels on a narrow bar. */}
            <span className="sr-only @[64rem]/configbar:not-sr-only">
              {t("extraction", "instructionTitle")}
            </span>
            {value === "" && (
              <span className="sr-only">
                {t("extraction", "instructionEmpty")}
              </span>
            )}
            {slotCount > 0 && (
              // A span, not a Badge: Badge renders a <div>, and a <button>
              // only admits phrasing content.
              <span
                data-testid="instruction-customize-chip"
                className="shrink-0 rounded-full border border-warning/50 bg-warning/10 px-1.5 text-[11px] text-warning"
              >
                {t("extraction", "instructionCustomizeChip").replace(
                  "{{n}}",
                  String(slotCount),
                )}
              </span>
            )}
            {unsaved && (
              <>
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warning"
                  aria-hidden
                />
                <span className="sr-only">
                  {t("extraction", "instructionUnsavedDraft")}
                </span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("extraction", "instructionTitle")}</TooltipContent>
      </Tooltip>
      <AiConfigDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        initialTab="instruction"
        withModel
        template={{
          id: templateId,
          instructionDraft: draft,
          onInstructionDraftChange: setDraft,
        }}
      />
    </>
  );
}

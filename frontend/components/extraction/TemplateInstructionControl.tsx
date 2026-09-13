import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  /** Owned by the host — see `TemplateInstructionPane`. */
  draft: string | null;
  /** Only passed when the host tracks expansion (an inline expander); a
   * dialog-style host that doesn't need `aria-expanded` omits it. */
  expanded?: boolean;
  onActivate: () => void;
}

/**
 * The config bar's ✨ trigger for the template-level general AI instruction.
 * The editing surface is TemplateInstructionPane, mounted by the host: the
 * extraction inspector (this trigger reveals it) or an inline expander on a
 * QA tool row (this trigger toggles it, so the host passes expanded). The
 * host owns the draft.
 *
 * What stays here is what a manager decides on at a glance: is an
 * instruction set, and does it still carry unfilled `[customize:]` slots.
 * Both live in the trigger's ACCESSIBLE NAME, never behind an `aria-label` —
 * an aria-label would replace the composed content and erase the warning for
 * exactly the users who cannot see the amber chip.
 */
export function TemplateInstructionControl({
  projectId,
  templateId,
  draft,
  expanded,
  onActivate,
}: TemplateInstructionControlProps) {
  const { data, isLoading } = useTemplateInstruction(projectId, templateId);

  if (isLoading || !data) {
    return <Skeleton className="h-7 w-24 shrink-0 rounded-md" />;
  }

  const value = data.llm_template_instruction ?? "";
  const slotCount = customizeSlotCount(data.llm_template_instruction);
  const unsaved = draft !== null && draft !== value;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onActivate}
          aria-expanded={expanded}
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
  );
}

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  useTemplateInstruction,
  useUpdateTemplateInstruction,
} from "@/hooks/extraction/useTemplateInstruction";
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
 * The template-level general AI instruction, as ONE control on the config
 * bar (spec Phase A §4 kept its behaviour; the 2026-08-29 consolidation
 * took its 48px row). It used to be a full-width collapsible row whose
 * headline feature was a truncated fragment of up to 4000 characters of
 * prose — decoration, in the most expensive vertical space on the screen.
 *
 * What survives the collapse is what a manager decides on at a glance: is
 * an instruction set, and does it still carry unfilled `[customize:]`
 * slots. Both live in the trigger's ACCESSIBLE NAME, never behind an
 * `aria-label` — an aria-label would replace the composed content and
 * erase the warning for exactly the users who cannot see the amber chip.
 *
 * The draft deliberately lives HERE and not inside the popover: Radix
 * unmounts popover content on close, so a draft owned by the surface would
 * be silently destroyed by a stray Escape or outside click. Dismissing
 * keeps the text and the trigger says so; only Cancel discards.
 */
export function TemplateInstructionControl({
  projectId,
  templateId,
}: TemplateInstructionControlProps) {
  const { data, isLoading } = useTemplateInstruction(projectId, templateId);
  const update = useUpdateTemplateInstruction(projectId, templateId);
  const [open, setOpen] = useState(false);
  // null = never edited this session; a string = a draft the manager owns.
  const [draft, setDraft] = useState<string | null>(null);

  if (isLoading || !data) {
    return <Skeleton className="h-7 w-24 shrink-0 rounded-md" />;
  }

  const value = data.llm_template_instruction ?? "";
  const hasOrigin = data.default_instruction != null;
  const slotCount = customizeSlotCount(data.llm_template_instruction);
  const unsaved = draft !== null && draft !== value;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Seed on first open only — a returning draft wins over the saved value.
    if (next && draft === null) setDraft(value);
  };

  const save = () => {
    if (draft === null) return;
    const normalized = draft.trim() === "" ? null : draft;
    update.mutate(normalized, {
      onSuccess: () => {
        toast.success(t("extraction", "instructionSavedToast"));
        setDraft(null);
        setOpen(false);
      },
      onError: () => {
        toast.error(t("extraction", "errors_saveInstruction"));
      },
    });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
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
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("extraction", "instructionTitle")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-[min(34rem,calc(100vw-2rem))] space-y-2 p-3"
      >
        <Textarea
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("extraction", "instructionPlaceholder")}
          maxLength={4000}
          rows={Math.min(
            12,
            Math.max(4, (draft ?? value).split("\n").length + 1),
          )}
          className="text-[13px]"
        />
        <div className="flex items-center gap-2">
          {(draft ?? value).length > 1600 && (
            <span className="text-[11px] text-muted-foreground">
              {t("extraction", "instructionCounter").replace(
                "{{n}}",
                String((draft ?? value).length),
              )}
            </span>
          )}
          <span className="flex-1" />
          {hasOrigin && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(data.default_instruction ?? "")}
            >
              {t("extraction", "instructionResetDefault")}
            </Button>
          )}
          {!hasOrigin && (draft ?? value) === "" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setDraft(t("extraction", "instructionSuggestedDefault"))
              }
            >
              {t("extraction", "instructionInsertDefault")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(null);
              setOpen(false);
            }}
          >
            {t("extraction", "instructionCancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={update.isPending || !unsaved}
          >
            {t("extraction", "instructionSave")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

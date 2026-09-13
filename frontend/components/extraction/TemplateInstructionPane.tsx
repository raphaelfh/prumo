import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import {
  useTemplateInstruction,
  useUpdateTemplateInstruction,
} from "@/hooks/extraction/useTemplateInstruction";
import { t } from "@/lib/copy";

const CUSTOMIZE_SLOT = /\[customize:[^\]]*\]/g;

interface TemplateInstructionPaneProps {
  projectId: string;
  templateId: string;
  /**
   * The draft deliberately lives in the HOST, not here: a host may unmount
   * and remount this pane (a collapsed dialog tab, an inline expander), so a
   * draft owned by this pane would be silently destroyed by that. The host
   * decides when to discard it.
   */
  draft: string | null;
  onDraftChange: (draft: string | null) => void;
}

/** The template-level general AI instruction editor. Hosted inline by the
 * extraction inspector and the QA configuration row; the host owns the
 * draft so collapsing or re-selecting never destroys it. */
export function TemplateInstructionPane({
  projectId,
  templateId,
  draft,
  onDraftChange,
}: TemplateInstructionPaneProps) {
  const { data, isLoading } = useTemplateInstruction(projectId, templateId);
  const update = useUpdateTemplateInstruction(projectId, templateId);

  if (isLoading || !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-7 w-40 rounded-md" />
      </div>
    );
  }

  const value = data.llm_template_instruction ?? "";
  const hasOrigin = data.default_instruction != null;
  const shown = draft ?? value;
  const unsaved = draft !== null && draft !== value;
  // Counted on what is ON SCREEN, not on the saved value: the warning has to
  // clear as the manager fills the slots, not on the next reload.
  const slotCount = (shown.match(CUSTOMIZE_SLOT) ?? []).length;

  const save = () => {
    if (draft === null) return;
    const normalized = draft.trim() === "" ? null : draft;
    update.mutate(normalized, {
      onSuccess: () => {
        toast.success(t("extraction", "instructionSavedToast"));
        onDraftChange(null);
      },
      onError: () => {
        toast.error(t("extraction", "errors_saveInstruction"));
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={shown}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={t("extraction", "instructionPlaceholder")}
        maxLength={4000}
        className="min-h-40 resize-y text-[13px]"
      />
      {slotCount > 0 && (
        // The bar's amber chip warns from outside; once you are IN the editor
        // the warning has to point at the text you are looking at, or the
        // placeholder ships into prompts verbatim.
        <p className="flex shrink-0 items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle
            className="mt-px size-3 shrink-0"
            strokeWidth={1.5}
            aria-hidden
          />
          <span>
            {t("extraction", "instructionCustomizeWarning").replace(
              "{{n}}",
              String(slotCount),
            )}
          </span>
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {shown.length > 1600 && (
          <span className="text-[11px] text-muted-foreground">
            {t("extraction", "instructionCounter").replace(
              "{{n}}",
              String(shown.length),
            )}
          </span>
        )}
        <span className="flex-1" />
        {hasOrigin && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDraftChange(data.default_instruction ?? "")}
          >
            {t("extraction", "instructionResetDefault")}
          </Button>
        )}
        {!hasOrigin && shown === "" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onDraftChange(t("extraction", "instructionSuggestedDefault"))
            }
          >
            {t("extraction", "instructionInsertDefault")}
          </Button>
        )}
        {unsaved && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onDraftChange(null)}
          >
            {t("extraction", "instructionCancel")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={update.isPending || !unsaved}
        >
          {t("extraction", "instructionSave")}
        </Button>
      </div>
    </div>
  );
}

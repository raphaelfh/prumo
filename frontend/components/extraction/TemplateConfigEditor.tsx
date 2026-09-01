/**
 * Template configuration editor (refactored)
 *
 * Main change: Works directly with extraction_entity_types
 * instead of "template instances" (is_template=true).
 *
 * Simplifies code and allows natural hierarchy support.
 */

import { useState } from "react";
import {
  createSection,
  deleteSection,
  updateEntityTypeLabel,
} from "@/services/templateService";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Import, Loader2, Plus } from "lucide-react";
import { TemplateConfigGridPanel } from "@/components/extraction/template-config/TemplateConfigGridPanel";
import { TemplateConfigPublishControls } from "@/components/extraction/template-config/TemplateConfigPublishControls";
import { TemplateExportButton } from "@/components/extraction/template-config/TemplateExportButton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GridField } from "@/components/extraction/template-config/templateTree";
import type { ExtractionFieldInsert } from "@/types/extraction";
import { toast } from "sonner";
import { t } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { AddSectionDialog, ImportTemplateDialog } from "./dialogs";
import type { AddSectionMode } from "./dialogs/AddSectionDialog";
import { useDeleteTemplateField } from "@/hooks/extraction/useDeleteTemplateField";
import { useTemplateEntityTypes } from "@/hooks/extraction/useTemplateEntityTypes";
import { useTemplateConfigCaches } from "@/hooks/extraction/useTemplateRepublish";
import { insertField } from "@/services/extractionFieldService";
import {
  captureSection,
  replaySection,
  type SectionSnapshot,
} from "@/components/extraction/template-config/sectionRestore";
import {
  useStructuralHistory,
  type StructuralStep,
} from "@/components/extraction/template-config/useStructuralHistory";

interface TemplateConfigEditorProps {
  projectId: string;
  templateId: string;
  /** Project-scoped chrome the PAGE owns, rendered into the config bar so
   * it stops costing a row of its own. Passed as a slot rather than built
   * here on purpose: choosing an engine must never arm the Draft chip or
   * enter the Publish diff, so the control stays outside this component's
   * template-versioned state. Optional — the editor renders without it. */
  engineSlot?: React.ReactNode;
  /** The dialog inside this editor can switch/import the ACTIVE template;
   * the host owns that state (this editor is keyed by it), so it must be
   * told which id is active now. */
  onActiveTemplateChanged?: (templateId: string) => void;
}

/** Hairline between two regimes on the config bar — project-scoped
 * settings, then the versioned-template commands Publish actually ships. */
function BarDivider() {
  return <span className="h-4 w-px shrink-0 bg-border/60" aria-hidden />;
}

export function TemplateConfigEditor({
  projectId,
  templateId,
  engineSlot,
  onActiveTemplateChanged,
}: TemplateConfigEditorProps) {
  // ONE cached read of the template structure, shared with the grid panel
  // (same key, same query). Every config mutation on this screen already
  // invalidates `templateEntityTypesKeys.byTemplate`, so the header count
  // refreshes itself — there is no hand-rolled reload protocol left.
  //
  // Three branches, and the order matters (B-9c2 D8): the hook returns
  // `query.data ?? []`, so a FAILED fetch is byte-identical to a template
  // with zero sections. `isError` must be answered before the empty state,
  // or a dropped connection reads as "your configuration is gone".
  const { entityTypes, isPending, isError } =
    useTemplateEntityTypes(templateId);
  // …but only while there is nothing cached. TanStack flips `status` to
  // error on a BACKGROUND failure and KEEPS the rows, and with staleTime at
  // 5min and refetch-on-focus off, that is the realistic error on this
  // screen: the invalidation that follows a mutation which already
  // succeeded (rename, add/remove section, delete field, Discard). Blanking
  // then discards a structure we still hold — along with the grid's
  // selection/search/collapse state and the Discard result pane, which is
  // mounted inside the publish controls in the success branch below.
  const structureRefreshFailed = isError && entityTypes.length > 0;
  // Which AddSectionDialog variant is open (B-8 D3); null = closed.
  const [addSectionMode, setAddSectionMode] = useState<AddSectionMode | null>(
    null,
  );
  const [showImportDialog, setShowImportDialog] = useState(false);
  // B-9b2a: the read-only diff sheet's trigger lives in the command bar
  // while the grid hosts the inspector Sheet, and two modal sheets must
  // never stack — so the flag belongs to their nearest common owner, here.
  const [diffSheetOpen, setDiffSheetOpen] = useState(false);
  // B-9d retired the delete-confirm dialog: the Publish ☑ ack gates what
  // reaches published data, and the grid arms a 6s Undo for the misclick.
  // The mutation stays here because the editor owns the cache refresh.
  const deleteFieldMutation = useDeleteTemplateField(projectId, templateId);
  // The ONE Undo/Redo slot for this surface. It lives here rather than in
  // the grid panel because section deletes are dispatched from here and
  // field moves/deletes from there — both must land in the same slot.
  const history = useStructuralHistory();
  const { invalidateStructure } = useTemplateConfigCaches(
    projectId,
    templateId,
  );

  /** Undo a delete: re-create the field in the slot it came from (B-9d).
   *
   * The row comes back with a NEW id, and that is sound precisely BECAUSE
   * the delete succeeded — every workflow `field_id` FK is ON DELETE
   * RESTRICT, so a field that could be deleted provably had nothing
   * pointing at it. What must survive is the SHAPE the manager authored,
   * so the payload is rebuilt from the grid projection rather than from a
   * bare name/type pair — including the ✨ AI instruction, the "Other"
   * option, the ADR-0016 disposition flags and the validation schema,
   * which the first ship silently dropped.
   */
  const restoreFieldNow = async (
    field: GridField,
    sectionId: string,
    index: number,
  ): Promise<string | null> => {
    const result = await insertField(projectId, templateId, {
      entity_type_id: sectionId,
      name: field.key,
      label: field.label,
      description: field.description,
      // The grid projection widens field_type to string; the insert
      // payload wants the closed union the server validates anyway.
      field_type: field.fieldType as ExtractionFieldInsert["field_type"],
      is_required: field.isRequired,
      llm_description: field.aiInstruction,
      allow_other: field.allowOther,
      other_label: field.otherLabel,
      other_placeholder: field.otherPlaceholder,
      allows_not_applicable: field.allowsNotApplicable,
      allows_not_evaluated: field.allowsNotEvaluated,
      allows_no_information: field.allowsNoInformation,
      validation_schema: field.validationSchema ?? {},
      allowed_values: field.allowedValues,
      unit: field.unit,
      allowed_units: field.allowedUnits,
      sort_order: index,
    });
    if (!result.ok) {
      console.error("[TemplateConfigEditor] restore failed:", result.error);
      toast.error(
        `${t("templateConfig", "errors_restoreField")}: ${result.error.message}`,
      );
      return null;
    }
    await invalidateStructure();
    return result.data.id;
  };

  /**
   * Delete a section with no confirmation, and arm the Undo (B-9d part 2).
   *
   * The snapshot is taken BEFORE the write, because the delete cascades:
   * a repeating group takes its child sections and every field beneath
   * them, and nothing is tombstoned — after the round trip there is
   * nothing left to read. It cannot live in `useStructuralUndo` — that
   * hook is panel-scoped and this needs the RAW `entityTypes` the editor
   * holds, which is where `role` and `is_required` survive.
   *
   * The delete runs through the SAME step a Redo would, so the write
   * exists in one place; the slot raises its own toast.
   */
  const deleteSectionNow = async (
    sectionId: string,
    label: string,
  ): Promise<void> => {
    const snapshot = captureSection(entityTypes, sectionId);
    if (!snapshot) {
      // Nothing to put back — delete, offer no Undo.
      const result = await deleteSection(projectId, templateId, sectionId);
      if (!result.ok) toast.error(result.error.message);
      else await invalidateStructure();
      return;
    }
    const undoStep = await deleteSectionStep(
      { projectId, templateId, invalidateStructure },
      sectionId,
      snapshot,
      label,
    ).apply();
    if (undoStep) history.push(undoStep);
  };

  /** Delete a field. B-9d removed the confirmation modal — the Publish ☑
   * ack is the real gate now (B-9b2b) and the grid arms a 6s Undo — so
   * this is dispatched straight from the row.
   *
   * Resolves a boolean rather than throwing: the panel needs to know
   * whether to arm Undo, and a refusal (recorded work, over the RESTRICT
   * FKs) has already been toasted as friendly copy by the mutation hook. */
  const deleteFieldNow = (fieldId: string) =>
    new Promise<boolean>((resolve) => {
      deleteFieldMutation.mutate(
        { fieldId },
        { onSuccess: () => resolve(true), onError: () => resolve(false) },
      );
    });

  // Task 6: the grid row owns the rename draft — only the WRITE lives
  // here (service call + cache refresh; the grid guarantees one commit
  // per rename, with a changed, non-empty, trimmed label).
  const handleSaveEdit = async (entityTypeId: string, label: string) => {
    const result = await updateEntityTypeLabel(
      projectId,
      templateId,
      entityTypeId,
      label,
    );
    if (!result.ok) {
      console.error("Erro ao atualizar label:", result.error);
      toast.error(`${t("common", "error")}: ${result.error.message}`);
      return;
    }
    toast.success(t("extraction", "labelUpdatedSuccess"));
    await invalidateStructure();
  };

  const handleSectionAdded = () => {
    setAddSectionMode(null);
    void invalidateStructure();
  };

  // Only the header count reads this now — the grid owns the hierarchy.
  const rootEntityTypes = entityTypes.filter((et) => !et.parent_entity_type_id);

  // isPending, NOT isFetching: only the first load may blank the screen. A
  // later refresh (a rename, a section add, a Discard) must keep the grid
  // mounted or the panel loses its view state — selection, search query,
  // collapsed sections, column toggles.
  if (isPending) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">
          {t("extraction", "loadingConfiguration")}
        </span>
      </div>
    );
  }

  if (isError && entityTypes.length === 0) {
    // Nothing cached: the only case where taking the screen is honest, and
    // the only one D8 is about. Replaces the imperative loader's
    // toast.error — a failure the user can still see (and retry) after the
    // toast would have expired. Retrying is the same invalidation every
    // mutation performs.
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <AlertTriangle
              className="h-10 w-10 mx-auto mb-3 text-destructive/70"
              strokeWidth={1.5}
            />
            <p className="text-sm font-medium mb-1 text-foreground">
              {t("templateConfig", "sectionsLoadFailedTitle")}
            </p>
            <p className="text-xs mb-4">
              {t("templateConfig", "sectionsLoadFailedBody")}
            </p>
            <Button
              variant="outline"
              onClick={() => void invalidateStructure()}
            >
              {t("common", "tryAgain")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    // h-full keeps the height chain DEFINITE (the grid card's max-h-full
    // depends on it). When the fixed rows outgrow the area, they overflow
    // this box and the parent's overflow-y-auto scrolls to them — growth
    // via min-h-full would instead make every height below indefinite and
    // un-cap the grid card.
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ONE configuration bar, and ONE trigger per destination. It absorbed
          three stacked bands (the engine chip's own row, this command bar and
          the 48px AI instruction row), and then the three AI triggers it had
          collected — engine, review question, ✨ instruction — which all
          opened the SAME AiConfigDialog on different tabs. The dialog's own
          tab strip is the picker; the bar carries one chip. Priority tracks
          (RunHeader's contract): the identity track is the only elastic one,
          every command is shrink-0, and Publish never collapses. */}
      <div
        className={cn(
          "@container/configbar flex shrink-0 items-center gap-2 rounded-md border border-border/40 bg-card px-3",
          // Fixed 48px chrome at every width a manager configures a template
          // at. Below the last collapse rung the commands genuinely do not
          // fit; wrapping was tried and read worse (the elastic identity
          // track claims a whole first line), so the cluster scrolls inside
          // its own bar instead — every control stays reachable and the
          // chrome stays 48px. Viewport, not container: an element cannot
          // query the container IT declares, so `@max-*/configbar` here
          // never matches.
          "h-12 max-sm:overflow-x-auto",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:hidden">
          {/* A count is a statistic, not a command: muted text, not a
              bordered Badge, and the first thing to fold when space runs out. */}
          <span className="hidden whitespace-nowrap text-[13px] text-muted-foreground @[52rem]/configbar:inline">
            {(entityTypes.length === 1
              ? t("extraction", "configSectionsCountOne")
              : t("extraction", "configSectionsCountOther")
            )
              .replace("{{n}}", String(entityTypes.length))
              .replace("{{main}}", String(rootEntityTypes.length))}
          </span>
        </div>
        {engineSlot && (
          <>
            {/* shrink-0, deliberately: the chip's own wrapper is
                `justify-end`, so squeezing its box spills the content off the
                LEFT edge ("GPT-" clipped) instead of ellipsing. It sheds parts
                of itself by container query instead — see LlmEngineChip. */}
            <div className="shrink-0">{engineSlot}</div>
            {/* Hairline between the project regime (the model, the review
                question and everything else the chip opens) and the
                versioned-template regime: none of it is part of what Publish
                ships. */}
            <BarDivider />
          </>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <TemplateExportButton projectId={projectId} templateId={templateId} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-testid="template-config-open-import"
                onClick={() => setShowImportDialog(true)}
                // Stays a visible, directly clickable button at every width: one
                // Playwright spec asserts toBeVisible() on this testid, which a
                // DropdownMenuItem could never satisfy while closed. The label
                // matches the accessible name (WCAG 2.5.3) when it folds away.
                aria-label={t("extraction", "configImportTemplateButton")}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Import
                  className="size-4 shrink-0"
                  strokeWidth={1.5}
                  aria-hidden
                />
                {/* One rung for both file commands: they are a pair, and
                    labelling one while the other is a bare icon read as two
                    unrelated controls. */}
                <span className="sr-only @[64rem]/configbar:not-sr-only">
                  {t("extraction", "configImportTemplateButton")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("extraction", "configImportTemplateButton")}
            </TooltipContent>
          </Tooltip>
          <BarDivider />
          <TemplateConfigPublishControls
            projectId={projectId}
            templateId={templateId}
            diffSheetOpen={diffSheetOpen}
            onDiffSheetOpenChange={setDiffSheetOpen}
          />
        </div>
      </div>

      {/* Degraded, not broken: the rows below are the last good read. An
          inline strip rather than a toast — the same reason the blocking
          card replaced one, and a toast would expire while the stale grid
          stayed on screen. */}
      {structureRefreshFailed && (
        <div
          role="alert"
          data-testid="template-config-refresh-failed"
          className="flex shrink-0 items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            {t("templateConfig", "sectionsRefreshFailedBody")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 hover:bg-warning/20 hover:text-warning"
            onClick={() => void invalidateStructure()}
          >
            {t("common", "tryAgain")}
          </Button>
        </div>
      )}

      {entityTypes.length > 0 && (
        // The grid absorbs the leftover column height (dashboard regime:
        // the panel scrolls inside, never the page). min-h-48 keeps the
        // field list useful when the fixed rows squeeze it (the column's
        // overflow escape hatch scrolls instead).
        <div className="min-h-48 flex-1">
          <TemplateConfigGridPanel
            projectId={projectId}
            templateId={templateId}
            diffSheetOpen={diffSheetOpen}
            sectionActions={{
              onCommitRename: (sectionId, label) =>
                void handleSaveEdit(sectionId, label),
              onDelete: (section) =>
                void deleteSectionNow(section.id, section.label),
              onAddPerModelSection: (group) =>
                setAddSectionMode({
                  kind: "perModel",
                  parentId: group.id,
                  parentLabel: group.label,
                  entryNoun: group.entryNoun,
                }),
            }}
            onDeleteField={deleteFieldNow}
            onRestoreField={restoreFieldNow}
            history={history}
            onAddSection={() => setAddSectionMode({ kind: "root" })}
            onAddGroup={() => setAddSectionMode({ kind: "group" })}
          />
        </div>
      )}

      {entityTypes.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <Plus className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium mb-1">
                {t("extraction", "noSectionsConfigured")}
              </p>
              <p className="text-xs mb-4">
                Import a global template or create custom sections
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  variant="outline"
                  data-testid="template-config-open-import"
                  onClick={() => setShowImportDialog(true)}
                >
                  <Import className="h-4 w-4 mr-2" />
                  {t("extraction", "configImportTemplateButton")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAddSectionMode({ kind: "root" })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("extraction", "addSection")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Adding a section lives in the grid now: the rail footer and
            the end-of-grid ghost row. A third button here was duplicate. */}

      {/* Dialogs. Field add/edit went inline in B-5 (ghost rows + the
          inspector); AddSectionDialog is the PERMANENT create surface
          for sections — B-8 made it modal (root / repeating group /
          per-model), reached from the grid's ＋▾ menus and ghost rows
          (inline section creation was dropped in the B-8 plan). Keyed
          by mode so the form re-initializes per variant. */}
      <AddSectionDialog
        key={addSectionMode?.kind ?? "root"}
        projectId={projectId}
        templateId={templateId}
        open={addSectionMode !== null}
        mode={addSectionMode ?? { kind: "root" }}
        onOpenChange={(open) => {
          if (!open) setAddSectionMode(null);
        }}
        onSectionAdded={handleSectionAdded}
      />

      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        // Pure pass-through: the dialog already closed itself, and the host
        // owns both the cache refresh and `activeTemplate` (this editor is
        // keyed by it) — doing either here would just do it twice.
        onActiveTemplateChanged={(activeTemplateId) =>
          onActiveTemplateChanged?.(activeTemplateId)
        }
      />
    </div>
  );
}

// Module scope on purpose: a step sits in the slot for the whole editing
// session, and a factory declared in the component body would close over
// that render's scope — pinning the entire raw `entityTypes` array (every
// section, every field, every AI instruction) long after the invalidation
// that followed the edit replaced it. These retain only their arguments.
interface SectionStepDeps {
  projectId: string;
  templateId: string;
  invalidateStructure: () => Promise<void>;
}

/** Put the captured subtree back; resolves the step that deletes it again
 * (Redo), addressing the id the replay just minted. */
function restoreSectionStep(
  deps: SectionStepDeps,
  snapshot: SectionSnapshot,
  label: string,
): StructuralStep {
  const { projectId, templateId, invalidateStructure } = deps;
  return {
    label: t("templateConfig", "undoDeleteSectionToast").replace(
      "{{section}}",
      label,
    ),
    apply: async () => {
      const restoredId = await replaySection(snapshot, {
        createSection: (params) =>
          createSection({ projectId, templateId, ...params }),
        insertField: (payload) => insertField(projectId, templateId, payload),
      });
      await invalidateStructure();
      if (!restoredId) {
        toast.error(t("templateConfig", "errors_restoreSection"));
        return null;
      }
      return deleteSectionStep(deps, restoredId, snapshot, label);
    },
  };
}

function deleteSectionStep(
  deps: SectionStepDeps,
  sectionId: string,
  snapshot: SectionSnapshot,
  label: string,
): StructuralStep {
  return {
    label: t("templateConfig", "undoDeleteSectionToast").replace(
      "{{section}}",
      label,
    ),
    apply: async () => {
      const result = await deleteSection(deps.projectId, deps.templateId, sectionId);
      if (!result.ok) {
        // Recorded extraction work anywhere under the section refuses the
        // delete (409); the service maps it to friendly copy.
        toast.error(result.error.message);
        return null;
      }
      await deps.invalidateStructure();
      return restoreSectionStep(deps, snapshot, label);
    },
  };
}

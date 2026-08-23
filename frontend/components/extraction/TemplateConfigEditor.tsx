/**
 * Template configuration editor (refactored)
 *
 * Main change: Works directly with extraction_entity_types
 * instead of "template instances" (is_template=true).
 *
 * Simplifies code and allows natural hierarchy support.
 */

import {useState} from 'react';
import {createSection, deleteSection, updateEntityTypeLabel} from '@/services/templateService';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {AlertTriangle, Download, Loader2, Plus, Settings} from 'lucide-react';
import {TemplateInstructionRow} from '@/components/extraction/TemplateInstructionRow';
import {TemplateConfigGridPanel} from '@/components/extraction/template-config/TemplateConfigGridPanel';
import {TemplateConfigPublishControls} from '@/components/extraction/template-config/TemplateConfigPublishControls';
import type {GridField} from '@/components/extraction/template-config/templateTree';
import type {ExtractionFieldInsert} from '@/types/extraction';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {AddSectionDialog, ImportTemplateDialog} from './dialogs';
import type {AddSectionMode} from './dialogs/AddSectionDialog';
import {useDeleteTemplateField} from '@/hooks/extraction/useDeleteTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {insertField} from '@/services/extractionFieldService';
import {captureSection, replaySection} from '@/components/extraction/template-config/sectionRestore';
import {STRUCTURAL_UNDO_TOAST_ID} from '@/components/extraction/template-config/useStructuralUndo';

interface TemplateConfigEditorProps {
  projectId: string;
  templateId: string;
  /** The dialog inside this editor can switch/import the ACTIVE template;
   * the host owns that state (this editor is keyed by it), so it must be
   * told which id is active now. */
  onActiveTemplateChanged?: (templateId: string) => void;
}

export function TemplateConfigEditor({
  projectId,
  templateId,
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
  const {entityTypes, isPending, isError} = useTemplateEntityTypes(templateId);
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
  const [addSectionMode, setAddSectionMode] = useState<AddSectionMode | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  // B-9b2a: the read-only diff sheet's trigger lives in the command bar
  // while the grid hosts the inspector Sheet, and two modal sheets must
  // never stack — so the flag belongs to their nearest common owner, here.
  const [diffSheetOpen, setDiffSheetOpen] = useState(false);
  // B-9d retired the delete-confirm dialog: the Publish ☑ ack gates what
  // reaches published data, and the grid arms a 6s Undo for the misclick.
  // The mutation stays here because the editor owns the cache refresh.
  const deleteFieldMutation = useDeleteTemplateField(projectId, templateId);
  const {invalidateStructure, invalidateAfterImport} = useTemplateConfigCaches(
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
  ): Promise<boolean> => {
    const result = await insertField(projectId, templateId, {
      entity_type_id: sectionId,
      name: field.key,
      label: field.label,
      description: field.description,
      // The grid projection widens field_type to string; the insert
      // payload wants the closed union the server validates anyway.
      field_type: field.fieldType as ExtractionFieldInsert['field_type'],
      is_required: field.isRequired,
      llm_description: field.aiInstruction,
      allow_other: field.allowOther,
      other_label: field.otherLabel,
      other_placeholder: field.otherPlaceholder,
      allows_not_applicable: field.allowsNotApplicable,
      allows_not_evaluated: field.allowsNotEvaluated,
      validation_schema: field.validationSchema ?? {},
      allowed_values: field.allowedValues,
      unit: field.unit,
      allowed_units: field.allowedUnits,
      sort_order: index,
    });
    if (!result.ok) {
      console.error('[TemplateConfigEditor] restore failed:', result.error);
      toast.error(
        `${t('templateConfig', 'errors_restoreField')}: ${result.error.message}`,
      );
      return false;
    }
    await invalidateStructure();
    return true;
  };

  /**
   * Delete a section with no confirmation, and arm the Undo (B-9d part 2).
   *
   * The snapshot is taken BEFORE the write, because the delete cascades:
   * a repeating group takes its child sections and every field beneath
   * them, and nothing is tombstoned — after the round trip there is
   * nothing left to read.
   *
   * The undo shares the ONE structural slot (`STRUCTURAL_UNDO_TOAST_ID`)
   * with the grid's move/delete undos: pushing under that id replaces a
   * live toast, which is what keeps "one live undo at a time" true across
   * the two owners. It cannot live in `useStructuralUndo` itself — that
   * hook is panel-scoped and this needs the RAW `entityTypes` the editor
   * holds, which is where `role` and `is_required` survive.
   */
  const deleteSectionNow = async (sectionId: string, label: string): Promise<void> => {
    const snapshot = captureSection(entityTypes, sectionId);
    const result = await deleteSection(projectId, templateId, sectionId);
    if (!result.ok) {
      // A section owning extraction instances cannot be deleted at all
      // (RESTRICT), and the service maps that 409 to friendly copy.
      toast.error(result.error.message);
      return;
    }
    await invalidateStructure();
    if (!snapshot) return;

    toast(t('templateConfig', 'undoDeleteSectionToast').replace('{{section}}', label), {
      id: STRUCTURAL_UNDO_TOAST_ID,
      duration: 6000,
      action: {
        label: t('templateConfig', 'undoAction'),
        onClick: () => {
          void replaySection(snapshot, {
            createSection: (params) =>
              createSection({projectId, templateId, ...params}),
            insertField: (payload) => insertField(projectId, templateId, payload),
          }).then(async (restored) => {
            if (!restored) toast.error(t('templateConfig', 'errors_restoreSection'));
            await invalidateStructure();
          });
        },
      },
    });
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
        {fieldId},
        {onSuccess: () => resolve(true), onError: () => resolve(false)},
      );
    });

  // Task 6: the grid row owns the rename draft — only the WRITE lives
  // here (service call + cache refresh; the grid guarantees one commit
  // per rename, with a changed, non-empty, trimmed label).
  const handleSaveEdit = async (entityTypeId: string, label: string) => {
    const result = await updateEntityTypeLabel(projectId, templateId, entityTypeId, label);
    if (!result.ok) {
      console.error('Erro ao atualizar label:', result.error);
      toast.error(`${t('common', 'error')}: ${result.error.message}`);
      return;
    }
    toast.success(t('extraction', 'labelUpdatedSuccess'));
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
          <span className="ml-3 text-muted-foreground">{t('extraction', 'loadingConfiguration')}</span>
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
              {t('templateConfig', 'sectionsLoadFailedTitle')}
            </p>
            <p className="text-xs mb-4">{t('templateConfig', 'sectionsLoadFailedBody')}</p>
            <Button variant="outline" onClick={() => void invalidateStructure()}>
              {t('common', 'tryAgain')}
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
    <div className="flex h-full min-h-0 flex-col gap-6">
      {/* Thin command bar (replaces the tall header Card). */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 rounded-md border border-border/40 bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Settings className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <span className="truncate text-sm font-medium">{t('extraction', 'configHeaderTitle')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {(entityTypes.length === 1
              ? t('extraction', 'configSectionsCountOne')
              : t('extraction', 'configSectionsCountOther')
            )
              .replace('{{n}}', String(entityTypes.length))
              .replace('{{main}}', String(rootEntityTypes.length))}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            data-testid="template-config-open-import"
            onClick={() => setShowImportDialog(true)}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            <Download className="h-4 w-4 mr-2" />
            {t('extraction', 'configImportTemplateButton')}
          </Button>
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
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="min-w-0 flex-1">
            {t('templateConfig', 'sectionsRefreshFailedBody')}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 hover:bg-warning/20 hover:text-warning"
            onClick={() => void invalidateStructure()}
          >
            {t('common', 'tryAgain')}
          </Button>
        </div>
      )}

      <TemplateInstructionRow projectId={projectId} templateId={templateId} />

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
          onCommitRename: (sectionId, label) => void handleSaveEdit(sectionId, label),
          onDelete: (section) => void deleteSectionNow(section.id, section.label),
          onAddPerModelSection: (group) =>
            setAddSectionMode({
              kind: 'perModel',
              parentId: group.id,
              parentLabel: group.label,
              entryNoun: group.entryNoun,
            }),
        }}
        onDeleteField={deleteFieldNow}
        onRestoreField={restoreFieldNow}
        onAddSection={() => setAddSectionMode({kind: 'root'})}
        onAddGroup={() => setAddSectionMode({kind: 'group'})}
      />
      </div>
      )}

      {entityTypes.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <Plus className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium mb-1">{t('extraction', 'noSectionsConfigured')}</p>
              <p className="text-xs mb-4">
                  Import a global template or create custom sections
              </p>
                <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  variant="outline"
                  data-testid="template-config-open-import"
                  onClick={() => setShowImportDialog(true)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('extraction', 'configImportTemplateButton')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAddSectionMode({kind: 'root'})}
                >
                  <Plus className="h-4 w-4 mr-2" />
                    {t('extraction', 'addSection')}
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
        key={addSectionMode?.kind ?? 'root'}
        projectId={projectId}
        templateId={templateId}
        open={addSectionMode !== null}
        mode={addSectionMode ?? {kind: 'root'}}
        onOpenChange={(open) => {
          if (!open) setAddSectionMode(null);
        }}
        onSectionAdded={handleSectionAdded}
      />


      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onActiveTemplateChanged={(activeTemplateId) => {
          setShowImportDialog(false);
          // Import/switch publish server-side, possibly for a DIFFERENT
          // template — id-free .all invalidation, which covers this
          // template's entity-types key too — then let the host re-point
          // `activeTemplate` (it owns that state; this editor is keyed by it).
          void invalidateAfterImport();
          onActiveTemplateChanged?.(activeTemplateId);
        }}
      />
    </div>
  );
}


/**
 * Template configuration editor (refactored)
 *
 * Main change: Works directly with extraction_entity_types
 * instead of "template instances" (is_template=true).
 *
 * Simplifies code and allows natural hierarchy support.
 */

import {useState} from 'react';
import {updateEntityTypeLabel} from '@/services/templateService';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {AlertTriangle, Download, Loader2, Plus, Settings} from 'lucide-react';
import {TemplateInstructionRow} from '@/components/extraction/TemplateInstructionRow';
import {TemplateConfigGridPanel} from '@/components/extraction/template-config/TemplateConfigGridPanel';
import {TemplateConfigPublishControls} from '@/components/extraction/template-config/TemplateConfigPublishControls';
import type {ExtractionField, FieldValidationResult} from '@/types/extraction';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {AddSectionDialog, ImportTemplateDialog, RemoveSectionDialog} from './dialogs';
import type {AddSectionMode} from './dialogs/AddSectionDialog';
import {DeleteFieldConfirm} from './dialogs/DeleteFieldConfirm';
import {useDeleteTemplateField} from '@/hooks/extraction/useDeleteTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {validateFieldImpact} from '@/services/extractionFieldService';

interface TemplateConfigEditorProps {
  projectId: string;
  templateId: string;
}

export function TemplateConfigEditor({ projectId, templateId }: TemplateConfigEditorProps) {
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
  const [removingSectionId, setRemovingSectionId] = useState<string | null>(null);
  const [removingSectionName, setRemovingSectionName] = useState('');
  // Cascade info when the section being removed is a repeating GROUP
  // (B-8 D4): child sections + their fields, from the grid tree.
  const [removingCascade, setRemovingCascade] = useState<{
    childCount: number;
    fieldsCount: number;
    noun: string;
  } | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  // B-9b2a: the read-only diff sheet's trigger lives in the command bar
  // while the grid hosts the inspector Sheet, and two modal sheets must
  // never stack — so the flag belongs to their nearest common owner, here.
  const [diffSheetOpen, setDiffSheetOpen] = useState(false);
  // Delete confirm (B-5 Task 7): hosted HERE, outside the grid panel's
  // React subtree — a Radix dialog inside the panel would bubble its
  // dismiss-Esc (portals propagate through the REACT tree) into the
  // panel's Esc ladder and close the inspector as a side effect.
  const [deletingField, setDeletingField] = useState<ExtractionField | null>(null);
  const deleteFieldMutation = useDeleteTemplateField(projectId, templateId);
  const {invalidateStructure, invalidateAfterImport} = useTemplateConfigCaches(
    projectId,
    templateId,
  );

  /** Impact pre-fetch for DeleteFieldConfirm. Never rejects: a probe
   * failure resolves as a cannot-delete result (the dialog's contract).
   * The probe is ADVISORY — the service's 23503 mapping is the real
   * invariant. */
  const validateForDelete = async (fieldId: string): Promise<FieldValidationResult> => {
    const result = await validateFieldImpact(
      fieldId,
      t('extraction', 'fieldSafeToModifyMessage'),
      (count, articles) =>
        t('extraction', 'fieldExtractedValuesMessage')
          .replace('{{count}}', String(count))
          .replace('{{n}}', String(articles)),
    );
    if (result.ok) return result.data;
    console.error('Error validating field impact:', result.error);
    return {
      canDelete: false,
      canUpdate: false,
      canChangeType: false,
      extractedValuesCount: 0,
      affectedArticles: [],
      message: t('extraction', 'errors_validateField'),
    };
  };

  /** Confirm-time delete: the SMALL dedicated mutation (service +
   * invalidateStructure) — resolves a boolean for the dialog without
   * throwing across a component body. */
  const confirmDeleteField = (fieldId: string) =>
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

  const handleSectionRemoved = () => {
    setRemovingSectionId(null);
    setRemovingSectionName('');
    setRemovingCascade(null);
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
    <div className="space-y-6">
      {/* Thin command bar (replaces the tall header Card). */}
      <div className="flex h-12 items-center justify-between gap-3 rounded-md border border-border/40 bg-card px-4">
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
          className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning"
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
      <TemplateConfigGridPanel
        projectId={projectId}
        templateId={templateId}
        diffSheetOpen={diffSheetOpen}
        sectionActions={{
          onCommitRename: (sectionId, label) => void handleSaveEdit(sectionId, label),
          onDelete: (section) => {
            setRemovingSectionId(section.id);
            setRemovingSectionName(section.label);
            // D4: a group's confirm leads with the cascade warning —
            // its child sections and their fields go with it.
            setRemovingCascade(
              section.kind === 'group'
                ? {
                    childCount: section.children.length,
                    fieldsCount: section.totalFieldCount - section.fieldCount,
                    noun: section.entryNoun,
                  }
                : null,
            );
          },
          onAddPerModelSection: (group) =>
            setAddSectionMode({
              kind: 'perModel',
              parentId: group.id,
              parentLabel: group.label,
              entryNoun: group.entryNoun,
            }),
        }}
        onDeleteField={setDeletingField}
        onAddSection={() => setAddSectionMode({kind: 'root'})}
        onAddGroup={() => setAddSectionMode({kind: 'group'})}
      />
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

      <RemoveSectionDialog
        projectId={projectId}
        templateId={templateId}
        sectionId={removingSectionId}
        sectionName={removingSectionName}
        groupCascade={removingCascade}
        open={!!removingSectionId}
        onOpenChange={(open) => {
          if (!open) {
            setRemovingSectionId(null);
            setRemovingSectionName('');
            setRemovingCascade(null);
          }
        }}
        onSectionRemoved={handleSectionRemoved}
      />

      {/* Mounted per open so the dialog's impact pre-fetch runs fresh.
          Kept OUTSIDE the grid panel subtree (see deletingField above). */}
      {deletingField && (
        <DeleteFieldConfirm
          field={deletingField}
          open
          onOpenChange={(open) => {
            if (!open) setDeletingField(null);
          }}
          onConfirm={confirmDeleteField}
          onValidate={validateForDelete}
          confirmPending={deleteFieldMutation.isPending}
        />
      )}

      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onTemplateImported={() => {
          setShowImportDialog(false);
          // Import publishes server-side (clone routes through republish),
          // possibly for a DIFFERENT template — id-free .all invalidation,
          // which covers this template's entity-types key too.
          void invalidateAfterImport();
        }}
      />
    </div>
  );
}


/**
 * Template configuration editor (refactored)
 *
 * Main change: Works directly with extraction_entity_types
 * instead of "template instances" (is_template=true).
 *
 * Simplifies code and allows natural hierarchy support.
 */

import {useEffect, useState} from 'react';
import {
  loadTemplateEntityTypes,
  updateEntityTypeLabel,
} from '@/services/templateService';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Download, Loader2, Plus, Settings} from 'lucide-react';
import {TemplateInstructionRow} from '@/components/extraction/TemplateInstructionRow';
import {TemplateConfigGridPanel} from '@/components/extraction/template-config/TemplateConfigGridPanel';
import {TemplateConfigPublishControls} from '@/components/extraction/template-config/TemplateConfigPublishControls';
import {TemplateFieldDialogs} from '@/components/extraction/template-config/TemplateFieldDialogs';
import type {ExtractionField, FieldValidationResult} from '@/types/extraction';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {AddSectionDialog, ImportTemplateDialog, RemoveSectionDialog} from './dialogs';
import {DeleteFieldConfirm} from './dialogs/DeleteFieldConfirm';
import {ExtractionEntityType} from '@/types/extraction';
import {useDeleteTemplateField} from '@/hooks/extraction/useDeleteTemplateField';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {validateFieldImpact} from '@/services/extractionFieldService';

interface TemplateConfigEditorProps {
  projectId: string;
  templateId: string;
}

export function TemplateConfigEditor({ projectId, templateId }: TemplateConfigEditorProps) {
  const [entityTypes, setEntityTypes] = useState<ExtractionEntityType[]>([]);
  // Only the FIRST load blanks the screen. Later refreshes (after a dialog
  // save, a rename, a section add) must keep the grid mounted — unmounting
  // it throws away the panel's view state: selection, search query,
  // collapsed sections and column toggles.
  const [initialLoading, setInitialLoading] = useState(true);
  const [showAddSectionDialog, setShowAddSectionDialog] = useState(false);
  const [removingSectionId, setRemovingSectionId] = useState<string | null>(null);
  const [removingSectionName, setRemovingSectionName] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  // Grid editing bridge (B-1): the grid selects, the existing dialogs edit.
  const [fieldDialog, setFieldDialog] = useState<{
    mode: 'add' | 'edit';
    entityTypeId: string;
    sectionName: string;
    field: ExtractionField | null;
  } | null>(null);
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

  const loadEntityTypes = async () => {

    console.warn('📦 Carregando entity types do template:', templateId);

    const result = await loadTemplateEntityTypes(templateId);

    if (!result.ok) {
      console.error('❌ Erro ao carregar entity types:', result.error);
      toast.error(`${t('common', 'error')}: ${result.error.message}`);
      setInitialLoading(false);
      return;
    }

    console.warn(`✅ Entity types encontrados: ${result.data.length}`);
    setEntityTypes(result.data as unknown as ExtractionEntityType[]);
    setInitialLoading(false);
  };

  useEffect(() => {
    if (projectId && templateId) {
      // Microtask so the loader's setState calls run in an async callback.
      queueMicrotask(() => void loadEntityTypes());
    }
  }, [projectId, templateId]);

  // Task 6: the grid row owns the rename draft — only the WRITE lives
  // here (service call + cache refresh; the grid guarantees one commit
  // per rename, with a changed, non-empty, trimmed label).
  const handleSaveEdit = async (entityTypeId: string, label: string) => {
    const result = await updateEntityTypeLabel(entityTypeId, label);
    if (!result.ok) {
      console.error('Erro ao atualizar label:', result.error);
      toast.error(`${t('common', 'error')}: ${result.error.message}`);
      return;
    }
    toast.success(t('extraction', 'labelUpdatedSuccess'));
    void invalidateStructure();
    await loadEntityTypes();
  };

  const handleSectionAdded = () => {
    setShowAddSectionDialog(false);
    void invalidateStructure();
    loadEntityTypes();
  };

  const handleSectionRemoved = () => {
    setRemovingSectionId(null);
    setRemovingSectionName('');
    void invalidateStructure();
    loadEntityTypes();
  };

  // Only the header count reads this now — the grid owns the hierarchy.
  const rootEntityTypes = entityTypes.filter((et) => !et.parent_entity_type_id);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">{t('extraction', 'loadingConfiguration')}</span>
      </div>
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
          />
        </div>
      </div>

      <TemplateInstructionRow projectId={projectId} templateId={templateId} />

      {entityTypes.length > 0 && (
      <TemplateConfigGridPanel
        projectId={projectId}
        templateId={templateId}
        onEditField={(field) => {
          const section = entityTypes.find((et) => et.id === field.entity_type_id);
          setFieldDialog({
            mode: 'edit',
            entityTypeId: field.entity_type_id,
            sectionName: section?.label ?? '',
            field,
          });
        }}
        sectionActions={{
          onCommitRename: (sectionId, label) => void handleSaveEdit(sectionId, label),
          onDelete: (section) => {
            setRemovingSectionId(section.id);
            setRemovingSectionName(section.label);
          },
          onAddField: (sectionId) => {
            const section = entityTypes.find((et) => et.id === sectionId);
            setFieldDialog({
              mode: 'add',
              entityTypeId: sectionId,
              sectionName: section?.label ?? '',
              field: null,
            });
          },
        }}
        onDeleteField={setDeletingField}
        onAddSection={() => setShowAddSectionDialog(true)}
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
                  onClick={() => setShowAddSectionDialog(true)}
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

      {/* Dialogs */}
      <AddSectionDialog
        projectId={projectId}
        templateId={templateId}
        open={showAddSectionDialog}
        onOpenChange={setShowAddSectionDialog}
        onSectionAdded={handleSectionAdded}
      />

      <RemoveSectionDialog
        projectId={projectId}
        templateId={templateId}
        sectionId={removingSectionId}
        sectionName={removingSectionName}
        open={!!removingSectionId}
        onOpenChange={(open) => {
          if (!open) {
            setRemovingSectionId(null);
            setRemovingSectionName('');
          }
        }}
        onSectionRemoved={handleSectionRemoved}
      />

      {fieldDialog && (
        <TemplateFieldDialogs
          mode={fieldDialog.mode}
          entityTypeId={fieldDialog.entityTypeId}
          sectionName={fieldDialog.sectionName}
          projectId={projectId}
          templateId={templateId}
          field={fieldDialog.field}
          onClose={() => setFieldDialog(null)}
        />
      )}

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
        />
      )}

      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onTemplateImported={() => {
          setShowImportDialog(false);
          // Import publishes server-side (clone routes through republish),
          // possibly for a DIFFERENT template — id-free .all invalidation.
          void invalidateAfterImport();
          loadEntityTypes();
        }}
      />
    </div>
  );
}


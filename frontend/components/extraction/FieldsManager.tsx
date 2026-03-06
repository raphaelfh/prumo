/**
 * Section fields manager
 *
 * View and edit fields of a section/entity.
 * Full CRUD: add, edit, remove fields.
 *
 * Features:
 * - Field list in table
 * - Inline edit (label, description, is_required)
 * - Add new field (dialog)
 * - Remove field with validation (dialog)
 * - Permission control (manager vs reviewer)
 * 
 * @component
 */

import {useCallback, useMemo} from 'react';
import {Loader2} from 'lucide-react';
import {useFieldManagement} from '@/hooks/extraction/useFieldManagement';
import {useFieldsManagerState} from '@/hooks/extraction/useFieldsManagerState';
import {useErrorHandler} from '@/hooks/extraction/useErrorHandler';
import {FieldsHeader} from './FieldsHeader';
import {FieldsTable} from './FieldsTable';
import {EmptyFieldsState} from './EmptyFieldsState';
import {AddFieldDialog} from './dialogs/AddFieldDialog';
import {DeleteFieldConfirm} from './dialogs/DeleteFieldConfirm';
import {EditFieldDialog} from './dialogs/EditFieldDialog';
import {useProject} from '@/contexts/ProjectContext';
import {t} from '@/lib/copy';
import type {ExtractionField} from '@/types/extraction';

interface FieldsManagerProps {
  entityTypeId: string;
  sectionName?: string;
}

export function FieldsManager({ entityTypeId, sectionName }: FieldsManagerProps) {
  const { project } = useProject();
  const projectId = project?.id || '';

  const {
    fields,
    loading,
    canEdit,
    canCreate,
    canDelete,
    userRole,
    addField,
    updateField,
    deleteField,
    validateField,
    createOtherSpecifyField,
    removeOtherSpecifyField,
  } = useFieldManagement({ entityTypeId, projectId });

  // Estado local centralizado
  const { state, actions } = useFieldsManagerState();
  const {
    editingId,
    editData,
    savingEdit,
    showAddDialog,
    showEditDialog,
    fieldToEdit,
    fieldToDelete,
    deleteValidation,
    validatingDelete,
  } = state;

  // Tratamento de erros
  const { handleFieldOperationError, handleFieldValidationError } = useErrorHandler();

  const handleStartEdit = useCallback((field: ExtractionField) => {
    actions.startEdit(field);
  }, [actions]);

  const handleSaveEdit = useCallback(async (fieldId: string) => {
    actions.setSavingEdit(true);
    try {
      const result = await updateField(fieldId, editData);
      if (result) {
        actions.cancelEdit();
      }
    } catch (error) {
        handleFieldOperationError(error, 'edit');
    } finally {
      actions.setSavingEdit(false);
    }
  }, [actions, updateField, editData, handleFieldOperationError]);

  const handleCancelEdit = useCallback(() => {
    actions.cancelEdit();
  }, [actions]);

  const handleOpenEditDialog = useCallback((field: ExtractionField) => {
    actions.openEditDialog(field);
  }, [actions]);

  const handleOpenDeleteDialog = useCallback(async (field: ExtractionField) => {
    actions.openDeleteDialog(field);
    
    try {
      const validation = await validateField(field.id);
      actions.setDeleteValidation(validation);
    } catch (error) {
      handleFieldValidationError(error);
      actions.setDeleteValidation({
        canDelete: false,
        canUpdate: false,
        canChangeType: false,
        extractedValuesCount: 0,
        affectedArticles: [],
          message: t('extraction', 'errors_validateField'),
      });
    } finally {
      actions.setValidatingDelete(null);
    }
  }, [actions, validateField, handleFieldValidationError]);

  const handleConfirmDelete = useCallback(async (fieldId: string) => {
    try {
      const success = await deleteField(fieldId);
      if (success) {
        actions.closeDeleteDialog();
      }
      return success;
    } catch (error) {
        handleFieldOperationError(error, 'delete');
      return false;
    }
  }, [actions, deleteField, handleFieldOperationError]);

  const getFieldTypeLabel = useCallback((type: string) => {
    const labels: Record<string, string> = {
        text: t('extraction', 'fieldTypeText'),
        number: t('extraction', 'fieldTypeNumber'),
        date: t('extraction', 'fieldTypeDate'),
        select: t('extraction', 'fieldTypeSelect'),
        multiselect: t('extraction', 'fieldTypeMultiselect'),
        boolean: t('extraction', 'fieldTypeBoolean'),
    };
    return labels[type] || type;
  }, []);

  // Memoizar valores computados
  const hasFields = useMemo(() => fields.length > 0, [fields.length]);

    // Dialog handlers - fixed to avoid closing inadvertently
  const dialogHandlers = useMemo(() => ({
    addDialog: (open: boolean) => {
      if (!open) actions.closeAddDialog();
    },
    editDialog: (open: boolean) => {
      if (!open) actions.closeEditDialog();
    },
    deleteDialog: (open: boolean) => {
      if (!open) actions.closeDeleteDialog();
    },
  }), [actions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{t('extraction', 'loadingFields')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="main" aria-labelledby="fields-header">
        {/* Header with actions */}
      <FieldsHeader
        fieldsCount={fields.length}
        userRole={userRole}
        canCreate={canCreate}
        onAddField={actions.openAddDialog}
      />

        {/* Fields table */}
      {!hasFields ? (
        <EmptyFieldsState
          canCreate={canCreate}
          onAddField={actions.openAddDialog}
        />
      ) : (
        <FieldsTable
          fields={fields}
          editingId={editingId}
          editData={editData}
          savingEdit={savingEdit}
          validatingDelete={validatingDelete}
          canEdit={canEdit}
          canDelete={canDelete}
          onStartEdit={handleStartEdit}
          onOpenEditDialog={handleOpenEditDialog}
          onUpdateEditData={actions.updateEditData}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={handleCancelEdit}
          onOpenDeleteDialog={handleOpenDeleteDialog}
          getFieldTypeLabel={getFieldTypeLabel}
        />
      )}

      {/* Dialogs */}
      <AddFieldDialog
        open={showAddDialog}
        onOpenChange={dialogHandlers.addDialog}
        onSave={addField}
        sectionName={sectionName}
        entityTypeId={entityTypeId}
        createOtherSpecifyField={createOtherSpecifyField}
        removeOtherSpecifyField={removeOtherSpecifyField}
      />

      <EditFieldDialog
        field={fieldToEdit}
        open={showEditDialog}
        onOpenChange={dialogHandlers.editDialog}
        onSave={updateField}
        onValidate={validateField}
        sectionName={sectionName}
        entityTypeId={entityTypeId}
        createOtherSpecifyField={createOtherSpecifyField}
        removeOtherSpecifyField={removeOtherSpecifyField}
      />

      <DeleteFieldConfirm
        field={fieldToDelete}
        open={!!fieldToDelete}
        onOpenChange={dialogHandlers.deleteDialog}
        onConfirm={handleConfirmDelete}
        validation={deleteValidation}
        loading={!!validatingDelete}
      />
    </div>
  );
}

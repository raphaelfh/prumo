/**
 * Gerenciador de Campos de uma Seção
 * 
 * Permite visualizar e editar os campos de uma seção/entidade.
 * Agora com CRUD completo: adicionar, editar, remover campos.
 * 
 * Features:
 * - Listagem de campos em tabela
 * - Edição inline (label, description, is_required)
 * - Adicionar novo campo (dialog)
 * - Remover campo com validação (dialog)
 * - Controle de permissões (manager vs reviewer)
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
      handleFieldOperationError(error, 'editar');
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
        message: 'Erro ao validar campo',
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
      handleFieldOperationError(error, 'excluir');
      return false;
    }
  }, [actions, deleteField, handleFieldOperationError]);

  const getFieldTypeLabel = useCallback((type: string) => {
    const labels: Record<string, string> = {
      text: 'Texto',
      number: 'Número',
      date: 'Data',
      select: 'Seleção',
      multiselect: 'Múltipla Escolha',
      boolean: 'Sim/Não',
    };
    return labels[type] || type;
  }, []);

  // Memoizar valores computados
  const hasFields = useMemo(() => fields.length > 0, [fields.length]);
  
  // Handlers de dialog - corrigido para não fechar inadvertidamente
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
        <span className="ml-2 text-sm text-muted-foreground">Carregando campos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="main" aria-labelledby="fields-header">
      {/* Header com ações */}
      <FieldsHeader
        fieldsCount={fields.length}
        userRole={userRole}
        canCreate={canCreate}
        onAddField={actions.openAddDialog}
      />

      {/* Tabela de campos */}
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

/**
 * Hook para gerenciar estado local do FieldsManager
 * 
 * Centraliza toda a lógica de estado local para melhor organização
 * e reutilização.
 * 
 * @module hooks/extraction/useFieldsManagerState
 */

import { useState, useCallback } from 'react';
import type { ExtractionField, FieldValidationResult } from '@/types/extraction';

interface FieldsManagerState {
  // Estados de edição inline
  editingId: string | null;
  editData: Partial<ExtractionField>;
  savingEdit: boolean;
  
  // Estados de dialogs
  showAddDialog: boolean;
  showEditDialog: boolean;
  fieldToEdit: ExtractionField | null;
  fieldToDelete: ExtractionField | null;
  deleteValidation: FieldValidationResult | null;
  validatingDelete: string | null;
}

interface FieldsManagerActions {
  // Ações de edição inline
  startEdit: (field: ExtractionField) => void;
  updateEditData: (data: Partial<ExtractionField>) => void;
  cancelEdit: () => void;
  setSavingEdit: (saving: boolean) => void;
  
  // Ações de dialogs
  openAddDialog: () => void;
  closeAddDialog: () => void;
  openEditDialog: (field: ExtractionField) => void;
  closeEditDialog: () => void;
  openDeleteDialog: (field: ExtractionField) => void;
  closeDeleteDialog: () => void;
  setDeleteValidation: (validation: FieldValidationResult | null) => void;
  setValidatingDelete: (fieldId: string | null) => void;
  
  // Ações de reset
  resetAll: () => void;
}

const initialState: FieldsManagerState = {
  editingId: null,
  editData: {},
  savingEdit: false,
  showAddDialog: false,
  showEditDialog: false,
  fieldToEdit: null,
  fieldToDelete: null,
  deleteValidation: null,
  validatingDelete: null,
};

export function useFieldsManagerState() {
  const [state, setState] = useState<FieldsManagerState>(initialState);

  const startEdit = useCallback((field: ExtractionField) => {
    setState(prev => ({
      ...prev,
      editingId: field.id,
      editData: {
        label: field.label,
        description: field.description,
        is_required: field.is_required,
      },
    }));
  }, []);

  const updateEditData = useCallback((data: Partial<ExtractionField>) => {
    setState(prev => ({
      ...prev,
      editData: { ...prev.editData, ...data },
    }));
  }, []);

  const cancelEdit = useCallback(() => {
    setState(prev => ({
      ...prev,
      editingId: null,
      editData: {},
    }));
  }, []);

  const setSavingEdit = useCallback((saving: boolean) => {
    setState(prev => ({ ...prev, savingEdit: saving }));
  }, []);

  const openAddDialog = useCallback(() => {
    setState(prev => ({ ...prev, showAddDialog: true }));
  }, []);

  const closeAddDialog = useCallback(() => {
    setState(prev => ({ ...prev, showAddDialog: false }));
  }, []);

  const openEditDialog = useCallback((field: ExtractionField) => {
    setState(prev => ({
      ...prev,
      fieldToEdit: field,
      showEditDialog: true,
    }));
  }, []);

  const closeEditDialog = useCallback(() => {
    setState(prev => ({
      ...prev,
      showEditDialog: false,
      fieldToEdit: null,
    }));
  }, []);

  const openDeleteDialog = useCallback((field: ExtractionField) => {
    setState(prev => ({
      ...prev,
      fieldToDelete: field,
      validatingDelete: field.id,
    }));
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setState(prev => ({
      ...prev,
      fieldToDelete: null,
      deleteValidation: null,
      validatingDelete: null,
    }));
  }, []);

  const setDeleteValidation = useCallback((validation: FieldValidationResult | null) => {
    setState(prev => ({ ...prev, deleteValidation: validation }));
  }, []);

  const setValidatingDelete = useCallback((fieldId: string | null) => {
    setState(prev => ({ ...prev, validatingDelete: fieldId }));
  }, []);

  const resetAll = useCallback(() => {
    setState(initialState);
  }, []);

  const actions: FieldsManagerActions = {
    startEdit,
    updateEditData,
    cancelEdit,
    setSavingEdit,
    openAddDialog,
    closeAddDialog,
    openEditDialog,
    closeEditDialog,
    openDeleteDialog,
    closeDeleteDialog,
    setDeleteValidation,
    setValidatingDelete,
    resetAll,
  };

  return {
    state,
    actions,
  };
}

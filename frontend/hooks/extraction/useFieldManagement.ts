/**
 * Hook to manage full CRUD of extraction fields
 *
 * Responsible for:
 * - Checking user permissions (manager, reviewer, viewer)
 * - Loading section (entity_type) fields
 * - Adding new fields with validation
 * - Updating existing fields
 * - Deleting fields (with impact validation)
 * - Reordering fields (batch update of sort_order)
 *
 * @module hooks/extraction/useFieldManagement
 */

import {useCallback, useEffect, useState} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {
    ExtractionField,
    ExtractionFieldInput,
    ExtractionFieldInsert,
    ExtractionFieldSchema,
    ExtractionFieldUpdate,
    FieldValidationResult,
    PermissionCheckResult,
} from '@/types/extraction';
import {
  checkProjectPermissions,
  loadEntityTypeFields,
  validateFieldImpact,
  insertField,
  updateField as updateFieldService,
  deleteField as deleteFieldService,
  reorderFields as reorderFieldsService,
} from '@/services/extractionFieldService';

interface UseFieldManagementProps {
  entityTypeId: string;
  projectId: string;
}

export function useFieldManagement({
  entityTypeId,
  projectId,
}: UseFieldManagementProps) {
  const { user } = useAuth();
  const [fields, setFields] = useState<ExtractionField[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<PermissionCheckResult>({
    canView: false,
    canEdit: false,
    canDelete: false,
    canCreate: false,
    role: null,
  });

  /**
   * Check user permissions in project
   */
  const checkPermissions = useCallback(async (): Promise<PermissionCheckResult> => {
    if (!user) {
      return {
        canView: false,
        canEdit: false,
        canDelete: false,
        canCreate: false,
        role: null,
        message: t('common', 'errors_userNotAuthenticated'),
      };
    }

    const result = await checkProjectPermissions(user.id, projectId);
    if (!result.ok) {
      console.error('Error checking permissions:', result.error);
      const errorResult: PermissionCheckResult = {
        canView: false,
        canEdit: false,
        canDelete: false,
        canCreate: false,
        role: null,
        message: t('extraction', 'errors_checkPermissions'),
      };
      setPermissions(errorResult);
      return errorResult;
    }

    setPermissions(result.data);
    return result.data;
  }, [user, projectId]);

  /**
   * Load section fields
   */
  const loadFields = useCallback(async () => {
    if (!entityTypeId) {
      console.warn('entityTypeId not provided');
      setFields([]);
      return;
    }

    setLoading(true);

    const result = await loadEntityTypeFields(entityTypeId);
    if (!result.ok) {
      console.error('Error loading fields:', result.error);
      toast.error(`${t('extraction', 'errors_loadFields')}: ${result.error.message}`);
      setFields([]);
    } else {
      setFields(result.data);
    }
    setLoading(false);
  }, [entityTypeId]);

  /**
   * Validate field before operations (check impact)
   */
  const validateField = useCallback(async (
    fieldId: string
  ): Promise<FieldValidationResult> => {
    const result = await validateFieldImpact(
      fieldId,
      t('extraction', 'fieldSafeToModifyMessage'),
      (count, articles) =>
        t('extraction', 'fieldExtractedValuesMessage')
          .replace('{{count}}', String(count))
          .replace('{{n}}', String(articles)),
    );

    if (!result.ok) {
      console.error('Error validating field:', result.error);
      return {
        canDelete: false,
        canUpdate: false,
        canChangeType: false,
        extractedValuesCount: 0,
        affectedArticles: [],
        message: t('extraction', 'errors_validateField'),
      };
    }
    return result.data;
  }, []);

  /**
   * Add new field
   */
  const addField = useCallback(async (
    fieldData: ExtractionFieldInput
  ): Promise<ExtractionField | null> => {
      // Check permissions
    const perms = await checkPermissions();
    if (!perms.canCreate) {
      toast.error(t('extraction', 'errors_noPermissionAddField'));
      return null;
    }

    // Validate with Zod — may throw ZodError
    const zodResult = ExtractionFieldSchema.safeParse(fieldData);
    if (!zodResult.success) {
      const firstError = zodResult.error.errors[0];
      toast.error(t('extraction', 'errors_validationPrefix').replace('{{message}}', firstError.message));
      return null;
    }
    const validatedData = zodResult.data;

    // Check if name already exists in this section
    const existingField = fields.find(f => f.name === validatedData.name);
    if (existingField) {
      toast.error(t('extraction', 'errors_fieldExistsInSection').replace('{{name}}', validatedData.name));
      return null;
    }

    // Calculate next sort_order
    const maxSortOrder = fields.reduce(
      (max, field) => Math.max(max, field.sort_order),
      0
    );

    const newField: ExtractionFieldInsert = {
      entity_type_id: entityTypeId,
      name: validatedData.name,
      label: validatedData.label,
      description: validatedData.description || null,
      field_type: validatedData.field_type,
      is_required: validatedData.is_required,
      validation_schema: validatedData.validation_schema || {},
      allowed_values: validatedData.allowed_values || null,
      unit: validatedData.unit || null,
      allowed_units: validatedData.allowed_units || null,
      sort_order: maxSortOrder + 1,
    };

    const result = await insertField(newField);
    if (!result.ok) {
      console.error('Error adding field:', result.error);
      toast.error(`${t('extraction', 'errors_addField')}: ${result.error.message}`);
      return null;
    }

    const createdField = result.data;
    setFields(prev => [...prev, createdField]);
    toast.success(t('extraction', 'fieldAddedSuccess').replace('{{label}}', createdField.label));
    return createdField;
  }, [fields, entityTypeId, checkPermissions]);

  /**
   * Create "Other (specify)" field associated with a select field
   */
  const createOtherSpecifyField = useCallback(async (
    parentFieldName: string,
    parentFieldLabel: string,
    sortOrder: number
  ): Promise<ExtractionField | null> => {
    const perms = await checkPermissions();
    if (!perms.canCreate) {
      toast.error(t('extraction', 'errors_noPermissionAddField'));
      return null;
    }

    const otherFieldName = `${parentFieldName}_other_specify`;
    const otherFieldLabel = `${parentFieldLabel} (Other - Specify)`;

    // Check if already exists
    const existingField = fields.find(f => f.name === otherFieldName);
    if (existingField) {
      return existingField;
    }

    const otherField: ExtractionFieldInsert = {
      entity_type_id: entityTypeId,
      name: otherFieldName,
      label: otherFieldLabel,
      description: `Specify when "Other (specify)" was selected in ${parentFieldLabel}`,
      field_type: 'text',
      is_required: false,
      validation_schema: {
        conditional_required: {
          depends_on: parentFieldName,
          required_when: 'Other (specify)'
        }
      },
      allowed_values: null,
      unit: null,
      allowed_units: null,
      sort_order: sortOrder + 1,
    };

    const result = await insertField(otherField);
    if (!result.ok) {
      console.error('Error creating Other specify field:', result.error);
      toast.error(`${t('extraction', 'errors_addField')}: ${result.error.message}`);
      return null;
    }

    const createdField = result.data;
    setFields(prev => [...prev, createdField]);
    return createdField;
  }, [fields, entityTypeId, checkPermissions]);

  /**
   * Update existing field
   */
  const updateField = useCallback(async (
    fieldId: string,
    updates: ExtractionFieldUpdate
  ): Promise<ExtractionField | null> => {
    // Check permissions
    const perms = await checkPermissions();
    if (!perms.canEdit) {
      toast.error(t('extraction', 'errors_noPermissionEditField'));
      return null;
    }

    // If trying to change type, validate
    if (updates.field_type) {
      const currentField = fields.find(f => f.id === fieldId);
      if (currentField && currentField.field_type !== updates.field_type) {
        const validation = await validateField(fieldId);
        if (!validation.canChangeType) {
          toast.error(t('extraction', 'errors_cannotChangeFieldType'));
          return null;
        }
      }
    }

    const result = await updateFieldService(fieldId, updates);
    if (!result.ok) {
      console.error('Error updating field:', result.error);
      toast.error(`${t('extraction', 'errors_updateField')}: ${result.error.message}`);
      return null;
    }

    const updatedField = result.data;
    setFields(prev =>
      prev.map(field => (field.id === fieldId ? updatedField : field))
    );
    toast.success(t('extraction', 'fieldUpdatedSuccess'));
    return updatedField;
  }, [fields, checkPermissions, validateField]);

  /**
   * Remove field (with impact validation)
   */
  const deleteField = useCallback(async (
    fieldId: string
  ): Promise<boolean> => {
    // Check permissions
    const perms = await checkPermissions();
    if (!perms.canDelete) {
      toast.error(t('extraction', 'errors_noPermissionRemoveField'));
      return false;
    }

    // Validate if can delete
    const validation = await validateField(fieldId);
    if (!validation.canDelete) {
      toast.error(validation.message || t('extraction', 'errors_cannotRemoveField'));
      return false;
    }

    const result = await deleteFieldService(fieldId);
    if (!result.ok) {
      console.error('Error removing field:', result.error);
      toast.error(`${t('extraction', 'errors_removeField')}: ${result.error.message}`);
      return false;
    }

    setFields(prev => prev.filter(field => field.id !== fieldId));
    toast.success(t('extraction', 'fieldRemovedSuccess'));
    return true;
  }, [checkPermissions, validateField]);

  /**
   * Remove associated "Other (specify)" field
   */
  const removeOtherSpecifyField = useCallback(async (
    parentFieldName: string
  ): Promise<boolean> => {
    const perms = await checkPermissions();
    if (!perms.canDelete) {
      toast.error(t('extraction', 'errors_noPermissionRemoveField'));
      return false;
    }

    const otherFieldName = `${parentFieldName}_other_specify`;
    const otherField = fields.find(f => f.name === otherFieldName);

    if (!otherField) {
      return true; // Already does not exist
    }

    // Check if has extracted data
    const validation = await validateField(otherField.id);
    if (validation.extractedValuesCount > 0) {
      toast.error(
        t('extraction', 'errors_cannotRemoveFieldWithData')
          .replace('{{label}}', otherField.label)
          .replace('{{n}}', String(validation.extractedValuesCount))
      );
      return false;
    }

    return deleteField(otherField.id);
  }, [fields, checkPermissions, validateField, deleteField]);

  /**
   * Reorder fields (batch update)
   */
  const reorderFields = useCallback(async (
    reorderedFields: { id: string; sort_order: number }[]
  ): Promise<boolean> => {
    // Check permissions
    const perms = await checkPermissions();
    if (!perms.canEdit) {
      toast.error(t('extraction', 'errors_noPermissionReorderField'));
      return false;
    }

    const result = await reorderFieldsService(reorderedFields);
    if (!result.ok) {
      console.error('Error reordering fields:', result.error);
      toast.error(`${t('extraction', 'errors_reorderFields')}: ${result.error.message}`);
      return false;
    }

    // Reload fields to ensure correct order
    await loadFields();
    toast.success(t('extraction', 'fieldsReorderSuccess'));
    return true;
  }, [checkPermissions, loadFields]);

    // Load permissions and fields on mount
  useEffect(() => {
    if (projectId && entityTypeId) {
      // Microtask so the loaders' setState calls run in async callbacks.
      queueMicrotask(() => {
        void checkPermissions();
        void loadFields();
      });
    }
  }, [projectId, entityTypeId, checkPermissions, loadFields]);

  return {
    // Estado
    fields,
    loading,
    permissions,
    canEdit: permissions.canEdit,
    canDelete: permissions.canDelete,
    canCreate: permissions.canCreate,
    userRole: permissions.role,

    // Operations
    addField,
    updateField,
    deleteField,
    reorderFields,

    // Validation
    validateField,

    // Campos "Other (specify)"
    createOtherSpecifyField,
    removeOtherSpecifyField,

    // Utilities
    refreshFields: loadFields,
    refreshPermissions: checkPermissions,
  };
}

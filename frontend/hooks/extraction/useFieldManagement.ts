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
import {supabase} from '@/integrations/supabase/client';
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
    ProjectMemberRole,
} from '@/types/extraction';

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

    try {
      const { data, error } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .single();

      if (error) {
          console.error('Error checking permissions:', error);
        throw error;
      }

      const role = data?.role as ProjectMemberRole;
      const isManager = role === 'manager';
      const isReviewer = role === 'reviewer';
      const canView = true; // Todos membros podem ver

      const result: PermissionCheckResult = {
        canView,
        canEdit: isManager,
        canDelete: isManager,
        canCreate: isManager,
        role,
      };

      setPermissions(result);
      return result;
    } catch (err: any) {
        console.error('Error checking permissions:', err);
      const errorResult = {
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
    try {
      const { data, error } = await supabase
        .from('extraction_fields')
        .select('*')
        .eq('entity_type_id', entityTypeId)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      setFields((data as ExtractionField[]) || []);
    } catch (err: any) {
        console.error('Error loading fields:', err);
        toast.error(`${t('extraction', 'errors_loadFields')}: ${err.message}`);
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [entityTypeId]);

  /**
   * Validate field before operations (check impact)
   */
  const validateField = useCallback(async (
    fieldId: string
  ): Promise<FieldValidationResult> => {
    try {
        // Count extracted values and affected articles
      const { data: valuesData, error: valuesError } = await supabase
        .from('extracted_values')
        .select('id, article_id')
        .eq('field_id', fieldId);

      if (valuesError) throw valuesError;

      const extractedCount = valuesData?.length || 0;
      const affectedArticles = Array.from(
        new Set(valuesData?.map(v => v.article_id) || [])
      );
      const hasValues = extractedCount > 0;

      return {
        canDelete: !hasValues,
        canUpdate: true,
        canChangeType: !hasValues,
        extractedValuesCount: extractedCount,
        affectedArticles,
        message: hasValues
            ? t('extraction', 'fieldExtractedValuesMessage')
                .replace('{{count}}', String(extractedCount))
                .replace('{{n}}', String(affectedArticles.length))
            : t('extraction', 'fieldSafeToModifyMessage'),
      };
    } catch (err: any) {
        console.error('Error validating field:', err);
      return {
        canDelete: false,
        canUpdate: false,
        canChangeType: false,
        extractedValuesCount: 0,
        affectedArticles: [],
          message: t('extraction', 'errors_validateField'),
      };
    }
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

    try {
        // Validate data with Zod
      const validatedData = ExtractionFieldSchema.parse(fieldData);

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

      const { data, error } = await supabase
        .from('extraction_fields')
        .insert(newField)
        .select()
        .single();

      if (error) throw error;

      const createdField = data as ExtractionField;
      setFields(prev => [...prev, createdField]);
        toast.success(t('extraction', 'fieldAddedSuccess').replace('{{label}}', createdField.label));
      
      return createdField;
    } catch (err: any) {
        // If Zod validation error
      if (err.name === 'ZodError') {
        const firstError = err.errors[0];
          toast.error(t('extraction', 'errors_validationPrefix').replace('{{message}}', firstError.message));
      } else {
          console.error('Error adding field:', err);
          toast.error(`${t('extraction', 'errors_addField')}: ${err.message}`);
      }
      return null;
    }
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

    try {
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

      const { data, error } = await supabase
        .from('extraction_fields')
        .insert(otherField)
        .select()
        .single();

      if (error) throw error;

      const createdField = data as ExtractionField;
      setFields(prev => [...prev, createdField]);
      return createdField;
    } catch (err: any) {
        console.error('Error creating Other specify field:', err);
        toast.error(`${t('extraction', 'errors_addField')}: ${err.message}`);
      return null;
    }
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

    try {
      const { data, error } = await supabase
        .from('extraction_fields')
        .update(updates)
        .eq('id', fieldId)
        .select()
        .single();

      if (error) throw error;

      const updatedField = data as ExtractionField;
      setFields(prev =>
        prev.map(field => (field.id === fieldId ? updatedField : field))
      );
        toast.success(t('extraction', 'fieldUpdatedSuccess'));
      
      return updatedField;
    } catch (err: any) {
        console.error('Error updating field:', err);
        toast.error(`${t('extraction', 'errors_updateField')}: ${err.message}`);
      return null;
    }
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

    try {
      const { error } = await supabase
        .from('extraction_fields')
        .delete()
        .eq('id', fieldId);

      if (error) throw error;

      setFields(prev => prev.filter(field => field.id !== fieldId));
        toast.success(t('extraction', 'fieldRemovedSuccess'));
      
      return true;
    } catch (err: any) {
        console.error('Error removing field:', err);
        toast.error(`${t('extraction', 'errors_removeField')}: ${err.message}`);
      return false;
    }
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

    try {
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

      const success = await deleteField(otherField.id);
      return success;
    } catch (err: any) {
        console.error('Error removing Other specify field:', err);
        toast.error(`${t('extraction', 'errors_removeField')}: ${err.message}`);
      return false;
    }
  }, [fields, checkPermissions, validateField, deleteField]);

  /**
   * Reordenar campos (batch update)
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

    try {
        // Update all sort_order in batch
      const updates = reorderedFields.map(({ id, sort_order }) =>
        supabase
          .from('extraction_fields')
          .update({ sort_order })
          .eq('id', id)
      );

      await Promise.all(updates);

        // Reload fields to ensure correct order
      await loadFields();
        toast.success(t('extraction', 'fieldsReorderSuccess'));
      
      return true;
    } catch (err: any) {
        console.error('Error reordering fields:', err);
        toast.error(`${t('extraction', 'errors_reorderFields')}: ${err.message}`);
      return false;
    }
  }, [checkPermissions, loadFields]);

    // Load permissions and fields on mount
  useEffect(() => {
    if (projectId && entityTypeId) {
      checkPermissions();
      loadFields();
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


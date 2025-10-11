/**
 * Hook para gerenciar CRUD completo de campos de extração
 * 
 * Responsável por:
 * - Verificar permissões do usuário (manager, reviewer, viewer)
 * - Carregar campos de uma seção (entity_type)
 * - Adicionar novos campos com validação
 * - Atualizar campos existentes
 * - Deletar campos (com validação de impacto)
 * - Reordenar campos (batch update de sort_order)
 * 
 * @module hooks/extraction/useFieldManagement
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  ExtractionField,
  ExtractionFieldInput,
  ExtractionFieldInsert,
  ExtractionFieldUpdate,
  ExtractionFieldSchema,
  FieldValidationResult,
  ProjectMemberRole,
  PermissionCheckResult,
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
   * Verificar permissões do usuário no projeto
   */
  const checkPermissions = useCallback(async (): Promise<PermissionCheckResult> => {
    if (!user) {
      return {
        canView: false,
        canEdit: false,
        canDelete: false,
        canCreate: false,
        role: null,
        message: 'Usuário não autenticado',
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
        console.error('Erro ao verificar permissões:', error);
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
      console.error('Erro ao verificar permissões:', err);
      const errorResult = {
        canView: false,
        canEdit: false,
        canDelete: false,
        canCreate: false,
        role: null,
        message: 'Erro ao verificar permissões',
      };
      setPermissions(errorResult);
      return errorResult;
    }
  }, [user, projectId]);

  /**
   * Carregar campos da seção
   */
  const loadFields = useCallback(async () => {
    if (!entityTypeId) {
      console.warn('entityTypeId não fornecido');
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
      console.error('Erro ao carregar campos:', err);
      toast.error(`Erro ao carregar campos: ${err.message}`);
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [entityTypeId]);

  /**
   * Validar campo antes de operações (verificar impacto)
   */
  const validateField = useCallback(async (
    fieldId: string
  ): Promise<FieldValidationResult> => {
    try {
      // Contar valores extraídos e artigos afetados
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
          ? `Este campo possui ${extractedCount} valores extraídos em ${affectedArticles.length} artigo(s).`
          : 'Campo pode ser modificado com segurança.',
      };
    } catch (err: any) {
      console.error('Erro na validação do campo:', err);
      return {
        canDelete: false,
        canUpdate: false,
        canChangeType: false,
        extractedValuesCount: 0,
        affectedArticles: [],
        message: 'Erro ao validar campo',
      };
    }
  }, []);

  /**
   * Adicionar novo campo
   */
  const addField = useCallback(async (
    fieldData: ExtractionFieldInput
  ): Promise<ExtractionField | null> => {
    // Verificar permissões
    const perms = await checkPermissions();
    if (!perms.canCreate) {
      toast.error('Você não tem permissão para adicionar campos');
      return null;
    }

    try {
      // Validar dados com Zod
      const validatedData = ExtractionFieldSchema.parse(fieldData);

      // Verificar se nome já existe nesta seção
      const existingField = fields.find(f => f.name === validatedData.name);
      if (existingField) {
        toast.error(`Já existe um campo com o nome "${validatedData.name}" nesta seção`);
        return null;
      }

      // Calcular próximo sort_order
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
      toast.success(`Campo "${createdField.label}" adicionado com sucesso!`);
      
      return createdField;
    } catch (err: any) {
      // Se for erro de validação Zod
      if (err.name === 'ZodError') {
        const firstError = err.errors[0];
        toast.error(`Validação: ${firstError.message}`);
      } else {
        console.error('Erro ao adicionar campo:', err);
        toast.error(`Erro ao adicionar campo: ${err.message}`);
      }
      return null;
    }
  }, [fields, entityTypeId, checkPermissions]);

  /**
   * Atualizar campo existente
   */
  const updateField = useCallback(async (
    fieldId: string,
    updates: ExtractionFieldUpdate
  ): Promise<ExtractionField | null> => {
    // Verificar permissões
    const perms = await checkPermissions();
    if (!perms.canEdit) {
      toast.error('Você não tem permissão para editar campos');
      return null;
    }

    // Se está tentando mudar o tipo, validar
    if (updates.field_type) {
      const currentField = fields.find(f => f.id === fieldId);
      if (currentField && currentField.field_type !== updates.field_type) {
        const validation = await validateField(fieldId);
        if (!validation.canChangeType) {
          toast.error(
            'Não é possível mudar o tipo de campo que já possui dados extraídos'
          );
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
      toast.success('Campo atualizado com sucesso!');
      
      return updatedField;
    } catch (err: any) {
      console.error('Erro ao atualizar campo:', err);
      toast.error(`Erro ao atualizar campo: ${err.message}`);
      return null;
    }
  }, [fields, checkPermissions, validateField]);

  /**
   * Remover campo (com validação de impacto)
   */
  const deleteField = useCallback(async (
    fieldId: string
  ): Promise<boolean> => {
    // Verificar permissões
    const perms = await checkPermissions();
    if (!perms.canDelete) {
      toast.error('Você não tem permissão para remover campos');
      return false;
    }

    // Validar se pode deletar
    const validation = await validateField(fieldId);
    if (!validation.canDelete) {
      toast.error(validation.message || 'Não é possível remover este campo');
      return false;
    }

    try {
      const { error } = await supabase
        .from('extraction_fields')
        .delete()
        .eq('id', fieldId);

      if (error) throw error;

      setFields(prev => prev.filter(field => field.id !== fieldId));
      toast.success('Campo removido com sucesso!');
      
      return true;
    } catch (err: any) {
      console.error('Erro ao remover campo:', err);
      toast.error(`Erro ao remover campo: ${err.message}`);
      return false;
    }
  }, [checkPermissions, validateField]);

  /**
   * Reordenar campos (batch update)
   */
  const reorderFields = useCallback(async (
    reorderedFields: { id: string; sort_order: number }[]
  ): Promise<boolean> => {
    // Verificar permissões
    const perms = await checkPermissions();
    if (!perms.canEdit) {
      toast.error('Você não tem permissão para reordenar campos');
      return false;
    }

    try {
      // Atualizar todos os sort_order em batch
      const updates = reorderedFields.map(({ id, sort_order }) =>
        supabase
          .from('extraction_fields')
          .update({ sort_order })
          .eq('id', id)
      );

      await Promise.all(updates);

      // Recarregar campos para garantir ordem correta
      await loadFields();
      toast.success('Ordem dos campos atualizada!');
      
      return true;
    } catch (err: any) {
      console.error('Erro ao reordenar campos:', err);
      toast.error(`Erro ao reordenar: ${err.message}`);
      return false;
    }
  }, [checkPermissions, loadFields]);

  // Carregar permissões e campos no mount
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

    // Operações
    addField,
    updateField,
    deleteField,
    reorderFields,

    // Validação
    validateField,

    // Utilitários
    refreshFields: loadFields,
    refreshPermissions: checkPermissions,
  };
}


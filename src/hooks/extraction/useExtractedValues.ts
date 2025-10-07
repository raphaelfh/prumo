/**
 * Hook para gerenciar valores extraídos
 * 
 * Gerencia a criação, atualização e exclusão de valores
 * extraídos para campos específicos das instâncias.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  ExtractedValue, 
  ExtractedValueInsert,
  ExtractionSource,
  ExtractionEvidence
} from '@/types/extraction';

interface UseExtractedValuesProps {
  projectId: string;
  articleId: string;
  instanceIds: string[];
}

export function useExtractedValues({ 
  projectId, 
  articleId, 
  instanceIds 
}: UseExtractedValuesProps) {
  const [values, setValues] = useState<ExtractedValue[]>([]);
  const [evidence, setEvidence] = useState<ExtractionEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar valores extraídos
  const loadValues = useCallback(async () => {
    if (!articleId || instanceIds.length === 0) {
      setValues([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('extracted_values')
        .select(`
          *,
          extraction_fields (*),
          profiles!extracted_values_reviewer_id_fkey (
            id,
            full_name,
            email
          )
        `)
        .eq('article_id', articleId)
        .in('instance_id', instanceIds)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setValues(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar valores extraídos:', err);
      setError(err.message);
    }
  }, [articleId, instanceIds]);

  // Carregar evidências
  const loadEvidence = useCallback(async () => {
    if (!articleId) {
      setEvidence([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('extraction_evidence')
        .select(`
          *,
          article_files (
            id,
            original_filename,
            file_role
          )
        `)
        .eq('article_id', articleId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      setEvidence(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar evidências:', err);
      setError(err.message);
    }
  }, [articleId]);

  // Carregar dados iniciais
  useEffect(() => {
    if (!articleId || instanceIds.length === 0) {
      setValues([]);
      setEvidence([]);
      setLoading(false);
      return;
    }
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        await Promise.all([
          loadValues(),
          loadEvidence()
        ]);
      } catch (err: any) {
        console.error('Erro ao carregar valores extraídos:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [articleId, instanceIds.join(',')]); // Dependências simplificadas

  // Salvar valor extraído
  const saveValue = useCallback(async (
    instanceId: string,
    fieldId: string,
    value: any,
    source: ExtractionSource = 'human',
    confidenceScore?: number,
    evidenceData?: any[]
  ): Promise<ExtractedValue | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Usuário não autenticado');

      const valueData: ExtractedValueInsert = {
        project_id: projectId,
        article_id: articleId,
        instance_id: instanceId,
        field_id: fieldId,
        value: {
          data: value,
          type: typeof value,
          timestamp: new Date().toISOString(),
          metadata: {
            source,
            confidence_score: confidenceScore,
            reviewer_id: user.id
          }
        },
        source,
        confidence_score: confidenceScore,
        evidence: evidenceData || [],
        reviewer_id: user.id,
        is_consensus: false
      };

      // Verificar se já existe valor para este campo desta instância deste revisor
      const existingValue = values.find(
        v => v.instance_id === instanceId && 
             v.field_id === fieldId && 
             v.reviewer_id === user.id
      );

      let data: ExtractedValue;

      if (existingValue) {
        // Atualizar valor existente
        const { data: updatedValue, error } = await supabase
          .from('extracted_values')
          .update({
            value: valueData.value,
            source,
            confidence_score: confidenceScore,
            evidence: evidenceData || [],
            updated_at: new Date().toISOString()
          })
          .eq('id', existingValue.id)
          .select(`
            *,
            extraction_fields (*),
            profiles!extracted_values_reviewer_id_fkey (
              id,
              full_name,
              email
            )
          `)
          .single();

        if (error) throw error;
        data = updatedValue;

        // Atualizar estado local
        setValues(prev => 
          prev.map(v => v.id === existingValue.id ? data : v)
        );

        toast.success('Valor atualizado com sucesso!');
      } else {
        // Criar novo valor
        const { data: newValue, error } = await supabase
          .from('extracted_values')
          .insert(valueData)
          .select(`
            *,
            extraction_fields (*),
            profiles!extracted_values_reviewer_id_fkey (
              id,
              full_name,
              email
            )
          `)
          .single();

        if (error) throw error;
        data = newValue;

        // Atualizar estado local
        setValues(prev => [...prev, data]);

        toast.success('Valor salvo com sucesso!');
      }

      return data;

    } catch (err: any) {
      console.error('Erro ao salvar valor:', err);
      toast.error(`Erro ao salvar valor: ${err.message}`);
      return null;
    }
  }, [projectId, articleId, values]);

  // Atualizar valor existente
  const updateValue = useCallback(async (
    valueId: string,
    updates: Partial<ExtractedValue>
  ): Promise<ExtractedValue | null> => {
    try {
      const { data, error } = await supabase
        .from('extracted_values')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', valueId)
        .select(`
          *,
          extraction_fields (*),
          profiles!extracted_values_reviewer_id_fkey (
            id,
            full_name,
            email
          )
        `)
        .single();

      if (error) throw error;

      // Atualizar estado local
      setValues(prev => 
        prev.map(v => v.id === valueId ? data : v)
      );

      toast.success('Valor atualizado com sucesso!');
      return data;

    } catch (err: any) {
      console.error('Erro ao atualizar valor:', err);
      toast.error(`Erro ao atualizar valor: ${err.message}`);
      return null;
    }
  }, []);

  // Excluir valor
  const deleteValue = useCallback(async (valueId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('extracted_values')
        .delete()
        .eq('id', valueId);

      if (error) throw error;

      // Atualizar estado local
      setValues(prev => prev.filter(v => v.id !== valueId));

      toast.success('Valor excluído com sucesso!');
      return true;

    } catch (err: any) {
      console.error('Erro ao excluir valor:', err);
      toast.error(`Erro ao excluir valor: ${err.message}`);
      return false;
    }
  }, []);

  // Definir valor como consenso
  const setConsensusValue = useCallback(async (
    instanceId: string,
    fieldId: string,
    valueId: string
  ): Promise<boolean> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Usuário não autenticado');

      // Primeiro, remover consenso de outros valores do mesmo campo
      const { error: clearError } = await supabase
        .from('extracted_values')
        .update({ is_consensus: false })
        .eq('instance_id', instanceId)
        .eq('field_id', fieldId);

      if (clearError) throw clearError;

      // Depois, definir o valor selecionado como consenso
      const { error: consensusError } = await supabase
        .from('extracted_values')
        .update({ 
          is_consensus: true,
          reviewer_id: user.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', valueId);

      if (consensusError) throw consensusError;

      // Recarregar valores
      await loadValues();

      toast.success('Valor definido como consenso!');
      return true;

    } catch (err: any) {
      console.error('Erro ao definir consenso:', err);
      toast.error(`Erro ao definir consenso: ${err.message}`);
      return false;
    }
  }, [loadValues]);

  // Adicionar evidência
  const addEvidence = useCallback(async (
    targetType: 'value' | 'instance',
    targetId: string,
    articleFileId?: string,
    pageNumber?: number,
    position?: any,
    textContent?: string
  ): Promise<ExtractionEvidence | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Usuário não autenticado');

      const { data, error } = await supabase
        .from('extraction_evidence')
        .insert({
          project_id: projectId,
          article_id: articleId,
          target_type: targetType,
          target_id: targetId,
          article_file_id: articleFileId,
          page_number: pageNumber,
          position: position || {},
          text_content: textContent,
          created_by: user.id
        })
        .select(`
          *,
          article_files (
            id,
            original_filename,
            file_role
          )
        `)
        .single();

      if (error) throw error;

      // Atualizar estado local
      setEvidence(prev => [...prev, data]);

      toast.success('Evidência adicionada com sucesso!');
      return data;

    } catch (err: any) {
      console.error('Erro ao adicionar evidência:', err);
      toast.error(`Erro ao adicionar evidência: ${err.message}`);
      return null;
    }
  }, [projectId, articleId]);

  // Obter valores por instância
  const getValuesByInstance = useCallback((instanceId: string): ExtractedValue[] => {
    return values.filter(v => v.instance_id === instanceId);
  }, [values]);

  // Obter valor consenso para um campo
  const getConsensusValue = useCallback((instanceId: string, fieldId: string): ExtractedValue | null => {
    return values.find(v => 
      v.instance_id === instanceId && 
      v.field_id === fieldId && 
      v.is_consensus
    ) || null;
  }, [values]);

  // Obter todos os valores para um campo (incluindo não-consenso)
  const getAllValuesForField = useCallback((instanceId: string, fieldId: string): ExtractedValue[] => {
    return values.filter(v => 
      v.instance_id === instanceId && 
      v.field_id === fieldId
    );
  }, [values]);

  // Obter evidências para um valor
  const getEvidenceForValue = useCallback((valueId: string): ExtractionEvidence[] => {
    return evidence.filter(e => 
      e.target_type === 'value' && 
      e.target_id === valueId
    );
  }, [evidence]);

  // Verificar se campo tem valores
  const hasValue = useCallback((instanceId: string, fieldId: string): boolean => {
    return values.some(v => v.instance_id === instanceId && v.field_id === fieldId);
  }, [values]);

  // Calcular progresso de preenchimento
  const getCompletionProgress = useCallback((instanceId: string, totalFields: number): number => {
    const instanceValues = getValuesByInstance(instanceId);
    const uniqueFields = new Set(instanceValues.map(v => v.field_id)).size;
    return totalFields > 0 ? Math.round((uniqueFields / totalFields) * 100) : 0;
  }, [getValuesByInstance]);

  return {
    // Estado
    values,
    evidence,
    loading,
    error,

    // Ações
    saveValue,
    updateValue,
    deleteValue,
    setConsensusValue,
    addEvidence,
    refreshValues: loadValues,

    // Utilitários
    getValuesByInstance,
    getConsensusValue,
    getAllValuesForField,
    getEvidenceForValue,
    hasValue,
    getCompletionProgress
  };
}

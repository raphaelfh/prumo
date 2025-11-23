/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Hook para gerenciar instâncias de extração
 * 
 * Gerencia APENAS instâncias (criação, atualização, exclusão).
 * Entity types são carregados separadamente usando useEntityTypes.
 * 
 * REFATORADO (Fase 5): Separado de entity types para seguir SRP.
 * Agora usa extractionInstanceService para centralizar lógica.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import { useEntityTypes } from './useEntityTypes';
import { 
  ExtractionInstance, 
  ExtractionInstanceInsert,
  ExtractionEntityType 
} from '@/types/extraction';

interface UseExtractionInstancesProps {
  projectId: string;
  articleId: string;
  templateId: string;
}

export function useExtractionInstances({ 
  projectId, 
  articleId, 
  templateId 
}: UseExtractionInstancesProps) {
  const [instances, setInstances] = useState<ExtractionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar entity types usando hook dedicado (SRP)
  const { entityTypes, loading: entityTypesLoading } = useEntityTypes({
    templateId,
    enabled: !!templateId,
  });

  // Memoizar service (singleton, mas garantir estabilidade)
  const service = useMemo(() => extractionInstanceService, []);

  // Carregar instâncias do artigo
  const loadInstances = useCallback(async () => {
    if (!articleId || !templateId) {
      setInstances([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('extraction_instances')
        .select(`
          *,
          extraction_entity_types (*)
        `)
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      setInstances(data || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao carregar instâncias';
      console.error('Erro ao carregar instâncias:', err);
      setError(message);
    }
  }, [articleId, templateId]);

  // Carregar dados iniciais (apenas instâncias)
  useEffect(() => {
    if (!articleId || !templateId) {
      setInstances([]);
      setLoading(false);
      return;
    }
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        await loadInstances();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro ao carregar instâncias';
        console.error('Erro ao carregar dados de instâncias:', err);
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [articleId, templateId, loadInstances]);

  // Criar nova instância (usando service)
  const createInstance = useCallback(async (
    entityTypeId: string,
    label: string,
    parentInstanceId?: string
  ): Promise<ExtractionInstance | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Usuário não autenticado');

      // Buscar entity type
      const entityType = entityTypes.find(et => et.id === entityTypeId);
      if (!entityType) {
        toast.error('Tipo de entidade não encontrado');
        return null;
      }

      // Delegar para o service
      const result = await service.createInstance({
        projectId,
        articleId,
        templateId,
        entityTypeId,
        entityType,
        parentInstanceId,
        label,
        userId: user.id
      });

      // Atualizar estado local
      if (result.wasCreated) {
        setInstances(prev => [...prev, result.instance]);
        toast.success(`Instância "${result.instance.label}" criada com sucesso!`);
      } else {
        toast.info('Instância já existe');
      }

      return result.instance;

    } catch (err: any) {
      console.error('Erro ao criar instância:', err);
      toast.error(`Erro ao criar instância: ${err.message}`);
      return null;
    }
  }, [projectId, articleId, templateId, entityTypes, service]);

  // Atualizar instância
  const updateInstance = useCallback(async (
    instanceId: string,
    updates: Partial<ExtractionInstance>
  ): Promise<ExtractionInstance | null> => {
    try {
      const { data, error } = await supabase
        .from('extraction_instances')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', instanceId)
        .select(`
          *,
          extraction_entity_types (*)
        `)
        .single();

      if (error) throw error;

      // Atualizar estado local
      setInstances(prev => 
        prev.map(instance => 
          instance.id === instanceId ? data : instance
        )
      );

      toast.success('Instância atualizada com sucesso!');
      return data;

    } catch (err: any) {
      console.error('Erro ao atualizar instância:', err);
      toast.error(`Erro ao atualizar instância: ${err.message}`);
      return null;
    }
  }, []);

  // Excluir instância (usando service)
  const deleteInstance = useCallback(async (instanceId: string): Promise<boolean> => {
    try {
      // Verificar se há valores associados (validação local)
      const { data: values, error: valuesError } = await supabase
        .from('extracted_values')
        .select('id')
        .eq('instance_id', instanceId)
        .limit(1);

      if (valuesError) throw valuesError;

      if (values && values.length > 0) {
        toast.error('Não é possível excluir instância que possui valores extraídos');
        return false;
      }

      // Delegar para o service (CASCADE automático)
      await service.removeInstance(instanceId);

      // Atualizar estado local
      setInstances(prev => prev.filter(instance => instance.id !== instanceId));

      toast.success('Instância excluída com sucesso!');
      return true;

    } catch (err: any) {
      console.error('Erro ao excluir instância:', err);
      toast.error(`Erro ao excluir instância: ${err.message}`);
      return false;
    }
  }, [service]);

  // Reordenar instâncias
  const reorderInstances = useCallback(async (
    entityTypeId: string,
    newOrder: { id: string; sort_order: number }[]
  ): Promise<boolean> => {
    try {
      // Atualizar todas as instâncias em uma transação
      const updates = newOrder.map(item => 
        supabase
          .from('extraction_instances')
          .update({ sort_order: item.sort_order })
          .eq('id', item.id)
      );

      await Promise.all(updates);

      // Recarregar instâncias
      await loadInstances();

      toast.success('Ordem das instâncias atualizada!');
      return true;

    } catch (err: any) {
      console.error('Erro ao reordenar instâncias:', err);
      toast.error(`Erro ao reordenar: ${err.message}`);
      return false;
    }
  }, [loadInstances]);

  // Obter instâncias por tipo de entidade
  const getInstancesByEntityType = useCallback((entityTypeId: string): ExtractionInstance[] => {
    return instances.filter(instance => instance.entity_type_id === entityTypeId);
  }, [instances]);

  // Obter instâncias filhas
  const getChildInstances = useCallback((parentInstanceId: string): ExtractionInstance[] => {
    return instances.filter(instance => instance.parent_instance_id === parentInstanceId);
  }, [instances]);

  // Verificar se pode criar instância
  const canCreateInstance = useCallback((entityTypeId: string): boolean => {
    const entityType = entityTypes.find(et => et.id === entityTypeId);
    if (!entityType) return false;

    // Se cardinalidade é 'one', verificar se já existe instância
    if (entityType.cardinality === 'one') {
      const existingInstance = instances.find(
        instance => instance.entity_type_id === entityTypeId
      );
      return !existingInstance;
    }

    // Se cardinalidade é 'many', sempre pode criar
    return true;
  }, [entityTypes, instances]);

  // Gerar próximo label para instância
  const generateNextLabel = useCallback((entityTypeId: string): string => {
    const entityType = entityTypes.find(et => et.id === entityTypeId);
    if (!entityType) return 'Nova Instância';

    const existingInstances = getInstancesByEntityType(entityTypeId);
    const baseLabel = entityType.label;

    if (existingInstances.length === 0) {
      return `${baseLabel} 1`;
    }

    // Encontrar próximo número
    let nextNumber = 1;
    const existingNumbers = existingInstances
      .map(instance => {
        const match = instance.label.match(/\d+$/);
        return match ? parseInt(match[0]) : 0;
      })
      .sort((a, b) => b - a);

    for (const num of existingNumbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else {
        break;
      }
    }

    return `${baseLabel} ${nextNumber}`;
  }, [entityTypes, getInstancesByEntityType]);

  // Loading combinado (instâncias OU entity types)
  const combinedLoading = loading || entityTypesLoading;

  return {
    // Estado
    instances,
    entityTypes, // Mantido para compatibilidade, mas carregado via hook dedicado
    loading: combinedLoading,
    error,

    // Ações
    createInstance,
    updateInstance,
    deleteInstance,
    reorderInstances,
    refreshInstances: loadInstances,

    // Utilitários
    getInstancesByEntityType,
    getChildInstances,
    canCreateInstance,
    generateNextLabel
  };
}

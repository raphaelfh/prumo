/**
 * Service Layer para gerenciamento de instâncias de extração
 * 
 * Centraliza toda a lógica de criação, atualização e remoção de instâncias,
 * proporcionando uma interface unificada e evitando duplicação de código.
 * 
 * FASE 3: Agora com observabilidade completa (logging + métricas).
 * 
 * @module services/extractionInstanceService
 */

import { supabase } from '@/integrations/supabase/client';
import { extractionLogger, performanceTracker } from '@/lib/extraction/observability';
import type { 
  ExtractionInstance, 
  ExtractionEntityType,
  ProjectExtractionTemplate 
} from '@/types/extraction';

// =================== INTERFACES ===================

export interface CreateInstanceParams {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  entityType: ExtractionEntityType;
  parentInstanceId?: string | null;
  label?: string;
  metadata?: any;
  userId: string;
}

export interface CreateInstanceResult {
  instance: ExtractionInstance;
  wasCreated: boolean;
}

export interface CreateHierarchyParams {
  projectId: string;
  articleId: string;
  templateId: string;
  parentEntityType: ExtractionEntityType;
  childEntityTypes: ExtractionEntityType[];
  label: string;
  metadata?: any;
  userId: string;
}

export interface CreateHierarchyResult {
  parent: ExtractionInstance;
  children: ExtractionInstance[];
}

export interface GetInstancesParams {
  articleId: string;
  templateId: string;
  options?: {
    entityTypeId?: string;
    parentInstanceId?: string | null;
    includeChildren?: boolean;
  };
}

// =================== SERVICE CLASS ===================

export class ExtractionInstanceService {
  /**
   * Gera próximo label único para um entity type
   */
  private async generateLabel(
    entityType: ExtractionEntityType,
    articleId: string,
    parentInstanceId?: string | null,
    parentInstance?: ExtractionInstance
  ): Promise<string> {
    // Contar instâncias existentes do mesmo tipo e parent
    const { count, error } = await supabase
      .from('extraction_instances')
      .select('*', { count: 'exact', head: true })
      .eq('article_id', articleId)
      .eq('entity_type_id', entityType.id)
      .eq('parent_instance_id', parentInstanceId || null);

    if (error) {
      console.warn('Erro ao contar instâncias, usando fallback:', error);
    }

    const nextNumber = (count || 0) + 1;

    // Se tem parent, incluir nome do parent no label
    if (parentInstance) {
      return `${parentInstance.label} - ${entityType.label} ${nextNumber}`;
    }

    return `${entityType.label} ${nextNumber}`;
  }

  /**
   * Verifica se nome único é necessário (prevenir constraint violation)
   */
  private async ensureUniqueName(
    label: string,
    articleId: string,
    entityTypeId: string,
    maxAttempts: number = 10
  ): Promise<string> {
    let uniqueLabel = label;
    let attempt = 1;

    while (attempt <= maxAttempts) {
      const { data: existing, error } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('entity_type_id', entityTypeId)
        .eq('label', uniqueLabel)
        .limit(1);

      if (error) throw error;

      if (!existing || existing.length === 0) {
        return uniqueLabel;
      }

      attempt++;
      uniqueLabel = attempt === 2 ? `${label} (2)` : label.replace(/\(\d+\)$/, `(${attempt})`);
    }

    // Fallback com timestamp
    return `${label} (${Date.now()})`;
  }

  /**
   * Cria uma nova instância de extração
   */
  async createInstance(params: CreateInstanceParams): Promise<CreateInstanceResult> {
    const {
      projectId,
      articleId,
      templateId,
      entityTypeId,
      entityType,
      parentInstanceId,
      label: customLabel,
      metadata = {},
      userId
    } = params;

    // Tracking de performance
    const perfId = performanceTracker.start('createInstance', {
      entityType: entityType.name,
      cardinality: entityType.cardinality
    });

    try {
      extractionLogger.debug('createInstance', 'Iniciando criação de instância', {
        entityType: entityType.name,
        cardinality: entityType.cardinality,
        hasParent: !!parentInstanceId
      });
      // Se for cardinality='one', verificar se já existe
      if (entityType.cardinality === 'one') {
        const { data: existing } = await supabase
          .from('extraction_instances')
          .select('*')
          .eq('article_id', articleId)
          .eq('entity_type_id', entityTypeId)
          .eq('parent_instance_id', parentInstanceId || null)
          .single();

        if (existing) {
          console.log('Instância cardinality=one já existe:', existing.label);
          return {
            instance: existing as ExtractionInstance,
            wasCreated: false
          };
        }
      }

      // Buscar parent instance se necessário
      let parentInstance: ExtractionInstance | undefined;
      if (parentInstanceId) {
        const { data } = await supabase
          .from('extraction_instances')
          .select('*')
          .eq('id', parentInstanceId)
          .single();
        
        if (data) {
          parentInstance = data as ExtractionInstance;
        }
      }

      // Gerar label se não fornecido
      const generatedLabel = customLabel || await this.generateLabel(
        entityType,
        articleId,
        parentInstanceId,
        parentInstance
      );

      // Garantir label único
      const uniqueLabel = await this.ensureUniqueName(
        generatedLabel,
        articleId,
        entityTypeId
      );

      // Calcular sort_order
      const { count } = await supabase
        .from('extraction_instances')
        .select('*', { count: 'exact', head: true })
        .eq('article_id', articleId)
        .eq('entity_type_id', entityTypeId)
        .eq('parent_instance_id', parentInstanceId || null);

      const sortOrder = count || 0;

      // Criar instância
      const { data: newInstance, error } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          entity_type_id: entityTypeId,
          parent_instance_id: parentInstanceId || null,
          label: uniqueLabel,
          sort_order: sortOrder,
          metadata,
          created_by: userId
        })
        .select()
        .single();

      if (error) throw error;

      const duration = performanceTracker.end(perfId);
      
      extractionLogger.info('createInstance', 'Instância criada com sucesso', {
        instanceId: newInstance.id,
        label: uniqueLabel,
        duration
      });

      return {
        instance: newInstance as ExtractionInstance,
        wasCreated: true
      };

    } catch (error: any) {
      performanceTracker.end(perfId);
      extractionLogger.error('createInstance', 'Falha ao criar instância', error, {
        entityType: entityType.name,
        label: customLabel
      });
      throw new Error(`Falha ao criar instância: ${error.message}`);
    }
  }

  /**
   * Cria hierarquia completa (parent + children)
   * Usado principalmente para models
   */
  async createHierarchy(params: CreateHierarchyParams): Promise<CreateHierarchyResult> {
    const {
      projectId,
      articleId,
      templateId,
      parentEntityType,
      childEntityTypes,
      label,
      metadata = {},
      userId
    } = params;

    const perfId = performanceTracker.start('createHierarchy', {
      parentType: parentEntityType.name,
      childrenCount: childEntityTypes.length
    });

    try {
      extractionLogger.info('createHierarchy', 'Iniciando criação de hierarquia', {
        parentType: parentEntityType.name,
        childrenCount: childEntityTypes.length,
        label
      });
      // 1. Criar parent instance
      const parentResult = await this.createInstance({
        projectId,
        articleId,
        templateId,
        entityTypeId: parentEntityType.id,
        entityType: parentEntityType,
        label,
        metadata,
        userId
      });

      const parentInstance = parentResult.instance;

      // 2. Criar child instances automaticamente (apenas para cardinality='one')
      const childrenToCreate = childEntityTypes.filter(
        et => et.cardinality === 'one' // Só criar automaticamente se for 'one'
      );

      const childInstances: ExtractionInstance[] = [];

      for (const childEntityType of childrenToCreate) {
        const childResult = await this.createInstance({
          projectId,
          articleId,
          templateId,
          entityTypeId: childEntityType.id,
          entityType: childEntityType,
          parentInstanceId: parentInstance.id,
          userId
        });

        childInstances.push(childResult.instance);
      }

      const duration = performanceTracker.end(perfId);
      
      extractionLogger.info('createHierarchy', 'Hierarquia criada com sucesso', {
        parentId: parentInstance.id,
        childrenCount: childInstances.length,
        duration
      });

      return {
        parent: parentInstance,
        children: childInstances
      };

    } catch (error: any) {
      performanceTracker.end(perfId);
      extractionLogger.error('createHierarchy', 'Falha ao criar hierarquia', error, {
        parentType: parentEntityType.name,
        label
      });
      throw new Error(`Falha ao criar hierarquia: ${error.message}`);
    }
  }

  /**
   * Remove uma instância (CASCADE automático via Postgres)
   */
  async removeInstance(instanceId: string): Promise<boolean> {
    const perfId = performanceTracker.start('removeInstance');

    try {
      extractionLogger.debug('removeInstance', 'Removendo instância', { instanceId });

      const { error } = await supabase
        .from('extraction_instances')
        .delete()
        .eq('id', instanceId);

      if (error) throw error;

      const duration = performanceTracker.end(perfId);
      
      extractionLogger.info('removeInstance', 'Instância removida (CASCADE)', {
        instanceId,
        duration
      });

      return true;

    } catch (error: any) {
      performanceTracker.end(perfId);
      extractionLogger.error('removeInstance', 'Falha ao remover instância', error, {
        instanceId
      });
      throw new Error(`Falha ao remover instância: ${error.message}`);
    }
  }

  /**
   * Busca instâncias com opções de filtro
   */
  async getInstances(params: GetInstancesParams): Promise<ExtractionInstance[]> {
    const { articleId, templateId, options = {} } = params;

    try {
      let query = supabase
        .from('extraction_instances')
        .select('*')
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .order('sort_order', { ascending: true });

      // Filtros opcionais
      if (options.entityTypeId) {
        query = query.eq('entity_type_id', options.entityTypeId);
      }

      if (options.parentInstanceId !== undefined) {
        query = query.eq('parent_instance_id', options.parentInstanceId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []) as ExtractionInstance[];

    } catch (error: any) {
      console.error('❌ Erro ao buscar instâncias:', error);
      throw new Error(`Falha ao buscar instâncias: ${error.message}`);
    }
  }

  /**
   * Cria instâncias iniciais para um artigo (study-level apenas)
   */
  async initializeArticleInstances(
    articleId: string,
    projectId: string,
    template: ProjectExtractionTemplate,
    entityTypes: ExtractionEntityType[],
    userId: string
  ): Promise<ExtractionInstance[]> {
    try {
      // Buscar instâncias existentes
      const existingInstances = await this.getInstances({
        articleId,
        templateId: template.id
      });

      const existingEntityTypeIds = new Set(
        existingInstances.map(i => i.entity_type_id)
      );

      const createdInstances: ExtractionInstance[] = [...existingInstances];

      // Criar instâncias faltantes apenas para:
      // - Entity types com cardinality='one'
      // - Entity types sem parent (study-level)
      for (const entityType of entityTypes) {
        if (existingEntityTypeIds.has(entityType.id)) {
          continue; // Já existe
        }

        // Pular se tem parent OU cardinality='many'
        if (entityType.parent_entity_type_id || entityType.cardinality === 'many') {
          console.log(`⏭️ Pulando criação automática: ${entityType.name}`);
          continue;
        }

        const result = await this.createInstance({
          projectId,
          articleId,
          templateId: template.id,
          entityTypeId: entityType.id,
          entityType,
          userId
        });

        if (result.wasCreated) {
          createdInstances.push(result.instance);
        }
      }

      console.log(`✅ Inicialização: ${createdInstances.length} instâncias total`);
      return createdInstances;

    } catch (error: any) {
      console.error('❌ Erro ao inicializar instâncias:', error);
      throw new Error(`Falha ao inicializar: ${error.message}`);
    }
  }
}

// =================== SINGLETON EXPORT ===================

/**
 * Instância singleton do service
 */
export const extractionInstanceService = new ExtractionInstanceService();


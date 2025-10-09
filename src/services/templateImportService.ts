/**
 * Serviço de Importação Inteligente de Templates
 * 
 * Implementa lógica robusta para:
 * - Detectar conflitos de templates
 * - Mesclar templates sem perda de dados
 * - Substituir templates com confirmação
 * - Garantir integridade referencial
 * 
 * @module
 */

import { supabase } from '@/integrations/supabase/client';
import type { 
  GlobalExtractionTemplate, 
  ProjectExtractionTemplate,
  ExtractionEntityType,
  ExtractionField 
} from '@/types/extraction';

// =================== INTERFACES ===================

export interface TemplateConflictInfo {
  hasConflict: boolean;
  existingTemplate?: {
    id: string;
    name: string;
    framework: string;
    extractedValuesCount: number;
  };
}

export interface MergeResult {
  success: boolean;
  sectionsAdded: number;
  fieldsAdded: number;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  templateId?: string;
  action?: 'created' | 'merged' | 'replaced';
  details?: {
    sectionsAdded?: number;
    fieldsAdded?: number;
  };
  error?: string;
}

// =================== VERIFICAÇÃO DE CONFLITO ===================

/**
 * Verifica se já existe um template ativo no projeto
 */
export async function checkTemplateConflict(
  projectId: string
): Promise<TemplateConflictInfo> {
  try {
    // Buscar template ativo
    const { data: existingTemplate, error: queryError } = await supabase
      .from('project_extraction_templates')
      .select('id, name, framework')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single();

    if (queryError && queryError.code !== 'PGRST116') { // PGRST116 = not found
      throw queryError;
    }

    if (!existingTemplate) {
      return { hasConflict: false };
    }

    // Contar valores extraídos
    const { data: countData, error: countError } = await supabase
      .rpc('count_extracted_values', { p_template_id: existingTemplate.id });

    if (countError) throw countError;

    return {
      hasConflict: true,
      existingTemplate: {
        id: existingTemplate.id,
        name: existingTemplate.name,
        framework: existingTemplate.framework,
        extractedValuesCount: countData || 0
      }
    };
  } catch (err: any) {
    console.error('❌ Erro ao verificar conflito de template:', err);
    throw err;
  }
}

// =================== CLONE SIMPLES ===================

/**
 * Clona template global para o projeto (sem conflito)
 */
export async function cloneTemplateToProject(
  projectId: string,
  globalTemplateId: string
): Promise<ImportResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    console.log('📋 Clonando template para projeto...');

    // 1. Buscar template global
    const { data: globalTemplate, error: templateError } = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('id', globalTemplateId)
      .single();

    if (templateError) throw templateError;
    if (!globalTemplate) throw new Error('Template global não encontrado');

    // 2. Criar project_extraction_template
    const { data: projectTemplate, error: projectTemplateError } = await supabase
      .from('project_extraction_templates')
      .insert({
        project_id: projectId,
        global_template_id: globalTemplateId,
        name: `${globalTemplate.name} (Importado)`,
        description: globalTemplate.description,
        framework: globalTemplate.framework,
        version: globalTemplate.version,
        schema: globalTemplate.schema,
        is_active: true,
        created_by: user.id
      })
      .select()
      .single();

    if (projectTemplateError) throw projectTemplateError;

    // 3. Buscar entity types do template global
    const { data: globalEntityTypes, error: entityTypesError } = await supabase
      .from('extraction_entity_types')
      .select('*')
      .is('template_id', globalTemplateId)
      .order('sort_order');

    if (entityTypesError) throw entityTypesError;

    // 4. Clonar entity types
    const entityTypeMapping: Record<string, string> = {};

    for (const globalEntity of globalEntityTypes || []) {
      const { data: newEntity, error: insertError } = await supabase
        .from('extraction_entity_types')
        .insert({
          project_template_id: projectTemplate.id,
          name: globalEntity.name,
          label: globalEntity.label,
          description: globalEntity.description,
          cardinality: globalEntity.cardinality,
          sort_order: globalEntity.sort_order,
          is_required: globalEntity.is_required
        })
        .select()
        .single();

      if (insertError) throw insertError;

      entityTypeMapping[globalEntity.id] = newEntity.id;
    }

    // 5. Buscar e clonar fields
    const { data: globalFields, error: fieldsError } = await supabase
      .from('extraction_fields')
      .select('*')
      .in('entity_type_id', Object.keys(entityTypeMapping))
      .order('sort_order');

    if (fieldsError) throw fieldsError;

    for (const globalField of globalFields || []) {
      const newEntityTypeId = entityTypeMapping[globalField.entity_type_id];
      if (!newEntityTypeId) continue;

      const { error: insertFieldError } = await supabase
        .from('extraction_fields')
        .insert({
          entity_type_id: newEntityTypeId,
          name: globalField.name,
          label: globalField.label,
          description: globalField.description,
          field_type: globalField.field_type,
          is_required: globalField.is_required,
          validation_schema: globalField.validation_schema,
          allowed_values: globalField.allowed_values,
          unit: globalField.unit,
          sort_order: globalField.sort_order
        });

      if (insertFieldError) throw insertFieldError;
    }

    console.log('✅ Template clonado com sucesso!');

    return {
      success: true,
      templateId: projectTemplate.id,
      action: 'created'
    };
  } catch (err: any) {
    console.error('❌ Erro ao clonar template:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

// =================== MERGE INTELIGENTE ===================

/**
 * Mescla novo template com o existente (adiciona só o que é novo)
 */
export async function mergeTemplates(
  projectId: string,
  existingTemplateId: string,
  globalTemplateId: string
): Promise<MergeResult> {
  try {
    console.log('🔀 Iniciando merge de templates...');

    // 1. Buscar entity types existentes
    const { data: existingEntityTypes, error: existingError } = await supabase
      .from('extraction_entity_types')
      .select('id, name, label')
      .eq('project_template_id', existingTemplateId);

    if (existingError) throw existingError;

    // 2. Buscar entity types do template global
    const { data: globalEntityTypes, error: globalError } = await supabase
      .from('extraction_entity_types')
      .select('*')
      .is('template_id', globalTemplateId)
      .order('sort_order');

    if (globalError) throw globalError;

    // 3. Identificar entity types novos (por label)
    const existingLabels = new Set(existingEntityTypes?.map(e => e.label) || []);
    const newEntityTypes = (globalEntityTypes || []).filter(
      ge => !existingLabels.has(ge.label)
    );

    let sectionsAdded = 0;
    let fieldsAdded = 0;
    const entityTypeMapping: Record<string, string> = {};

    // 4. Adicionar novos entity types
    for (const newEntity of newEntityTypes) {
      const { data: addedEntity, error: insertError } = await supabase
        .from('extraction_entity_types')
        .insert({
          project_template_id: existingTemplateId,
          name: newEntity.name,
          label: newEntity.label,
          description: newEntity.description,
          cardinality: newEntity.cardinality,
          sort_order: newEntity.sort_order,
          is_required: newEntity.is_required
        })
        .select()
        .single();

      if (insertError) throw insertError;

      entityTypeMapping[newEntity.id] = addedEntity.id;
      sectionsAdded++;
    }

    // 5. Para seções existentes, verificar campos novos
    const existingMapping: Record<string, string> = {};
    for (const existingEntity of existingEntityTypes || []) {
      const globalEntity = globalEntityTypes?.find(ge => ge.label === existingEntity.label);
      if (globalEntity) {
        existingMapping[globalEntity.id] = existingEntity.id;
      }
    }

    // 6. Buscar todos os fields do template global
    const { data: globalFields, error: globalFieldsError } = await supabase
      .from('extraction_fields')
      .select('*')
      .in('entity_type_id', globalEntityTypes?.map(e => e.id) || [])
      .order('sort_order');

    if (globalFieldsError) throw globalFieldsError;

    // 7. Para cada seção (nova ou existente), adicionar campos
    for (const globalField of globalFields || []) {
      // Determinar o entity_type_id no projeto
      let targetEntityTypeId = 
        entityTypeMapping[globalField.entity_type_id] || // Novo entity type
        existingMapping[globalField.entity_type_id];     // Entity type existente

      if (!targetEntityTypeId) continue;

      // Verificar se campo já existe (por label)
      const { data: existingFields } = await supabase
        .from('extraction_fields')
        .select('id, label')
        .eq('entity_type_id', targetEntityTypeId);

      const fieldExists = existingFields?.some(f => f.label === globalField.label);
      if (fieldExists) continue; // Skip se já existe

      // Adicionar campo novo
      const { error: insertFieldError } = await supabase
        .from('extraction_fields')
        .insert({
          entity_type_id: targetEntityTypeId,
          name: globalField.name,
          label: globalField.label,
          description: globalField.description,
          field_type: globalField.field_type,
          is_required: globalField.is_required,
          validation_schema: globalField.validation_schema,
          allowed_values: globalField.allowed_values,
          unit: globalField.unit,
          sort_order: globalField.sort_order
        });

      if (insertFieldError) throw insertFieldError;
      fieldsAdded++;
    }

    console.log(`✅ Merge concluído: +${sectionsAdded} seções, +${fieldsAdded} campos`);

    return {
      success: true,
      sectionsAdded,
      fieldsAdded
    };
  } catch (err: any) {
    console.error('❌ Erro ao mesclar templates:', err);
    return {
      success: false,
      sectionsAdded: 0,
      fieldsAdded: 0,
      error: err.message
    };
  }
}

// =================== REPLACE (SUBSTITUIR) ===================

/**
 * Substitui template atual por um novo (PERDE DADOS!)
 */
export async function replaceTemplate(
  projectId: string,
  existingTemplateId: string,
  globalTemplateId: string
): Promise<ImportResult> {
  try {
    console.log('🔄 Substituindo template (PERDA DE DADOS)...');

    // 1. Desativar template antigo
    await supabase
      .rpc('switch_active_template', {
        p_project_id: projectId,
        p_new_template_id: existingTemplateId // Temporariamente
      });

    // 2. Deletar dados antigos em cascata
    // (As foreign keys com ON DELETE CASCADE cuidam disso)
    const { error: deleteError } = await supabase
      .from('project_extraction_templates')
      .delete()
      .eq('id', existingTemplateId);

    if (deleteError) throw deleteError;

    // 3. Clonar novo template
    const result = await cloneTemplateToProject(projectId, globalTemplateId);

    if (!result.success) throw new Error(result.error);

    console.log('✅ Template substituído com sucesso!');

    return {
      success: true,
      templateId: result.templateId,
      action: 'replaced'
    };
  } catch (err: any) {
    console.error('❌ Erro ao substituir template:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

// =================== FUNÇÃO PRINCIPAL ===================

/**
 * Importa template com detecção inteligente de conflitos
 * 
 * Fluxo:
 * 1. Verifica se há conflito
 * 2. Se não: clona normalmente
 * 3. Se sim: retorna info do conflito para o usuário decidir
 */
export async function importTemplateWithConflictDetection(
  projectId: string,
  globalTemplateId: string
): Promise<{
  needsUserDecision: boolean;
  conflictInfo?: TemplateConflictInfo;
  result?: ImportResult;
}> {
  try {
    // Verificar conflito
    const conflictInfo = await checkTemplateConflict(projectId);

    if (!conflictInfo.hasConflict) {
      // Sem conflito, clonar diretamente
      const result = await cloneTemplateToProject(projectId, globalTemplateId);
      return {
        needsUserDecision: false,
        result
      };
    }

    // Tem conflito, retornar para usuário decidir
    return {
      needsUserDecision: true,
      conflictInfo
    };
  } catch (err: any) {
    console.error('❌ Erro na importação:', err);
    return {
      needsUserDecision: false,
      result: {
        success: false,
        error: err.message
      }
    };
  }
}



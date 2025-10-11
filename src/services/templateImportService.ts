/**
 * Serviço de Importação de Templates - VERSÃO LIMPA
 * 
 * Simplificado e refatorado para:
 * - Trabalhar apenas com entity_types (sem template instances)
 * - Preservar hierarquia sempre
 * - Código limpo e production-ready
 * 
 * @module services/templateImportService
 */

import { supabase } from '@/integrations/supabase/client';

// =================== INTERFACES ===================

export interface ImportResult {
  success: boolean;
  templateId?: string;
  error?: string;
  details?: {
    entityTypesAdded: number;
    fieldsAdded: number;
  };
}

// =================== FUNÇÃO PRINCIPAL: IMPORTAR TEMPLATE ===================

/**
 * Importa template global para o projeto
 * 
 * Fluxo simplificado:
 * 1. Verifica se já existe template ativo (apenas 1 permitido)
 * 2. Se existe, desativa o antigo
 * 3. Clona template global
 * 4. Preserva hierarquia (parent_entity_type_id)
 */
export async function importGlobalTemplate(
  projectId: string,
  globalTemplateId: string
): Promise<ImportResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    console.log('🚀 Importando template global...');
    console.log('  Project:', projectId);
    console.log('  Template:', globalTemplateId);

    // 1. Buscar template global
    const { data: globalTemplate, error: templateError } = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('id', globalTemplateId)
      .single();

    if (templateError) throw templateError;
    if (!globalTemplate) throw new Error('Template não encontrado');

    console.log(`  ✅ Template: ${globalTemplate.name} v${globalTemplate.version}`);

    // 2. Desativar qualquer template ativo existente
    const { data: existingTemplates } = await supabase
      .from('project_extraction_templates')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_active', true);

    if (existingTemplates && existingTemplates.length > 0) {
      console.log(`  📝 Desativando ${existingTemplates.length} template(s) antigo(s)...`);
      
      const { error: deactivateError } = await supabase
        .from('project_extraction_templates')
        .update({ is_active: false })
        .in('id', existingTemplates.map(t => t.id));

      if (deactivateError) throw deactivateError;
    }

    // 3. Criar project_extraction_template
    const { data: projectTemplate, error: projectTemplateError } = await supabase
      .from('project_extraction_templates')
      .insert({
        project_id: projectId,
        global_template_id: globalTemplateId,
        name: globalTemplate.name,
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

    console.log(`  ✅ Project template criado: ${projectTemplate.id}`);

    // 4. Buscar entity_types do template global
    const { data: globalEntityTypes, error: entityTypesError } = await supabase
      .from('extraction_entity_types')
      .select('*')
      .eq('template_id', globalTemplateId)
      .is('project_template_id', null)
      .order('sort_order');

    if (entityTypesError) throw entityTypesError;
    if (!globalEntityTypes || globalEntityTypes.length === 0) {
      throw new Error('Template não tem entity types');
    }

    console.log(`  ✅ Entity types encontrados: ${globalEntityTypes.length}`);

    // 5. Clonar entity_types (2 passadas para preservar hierarquia)
    const entityTypeMapping: Record<string, string> = {};

    console.log('  🔄 Clonando entity types (passada 1/2)...');
    for (const globalEntity of globalEntityTypes) {
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
          // parent_entity_type_id: null por enquanto
        })
        .select()
        .single();

      if (insertError) throw insertError;

      entityTypeMapping[globalEntity.id] = newEntity.id;
    }

    console.log('  🔄 Atualizando parent references (passada 2/2)...');
    for (const globalEntity of globalEntityTypes) {
      if (globalEntity.parent_entity_type_id) {
        const newEntityId = entityTypeMapping[globalEntity.id];
        const newParentId = entityTypeMapping[globalEntity.parent_entity_type_id];
        
        if (newEntityId && newParentId) {
          const { error: updateError } = await supabase
            .from('extraction_entity_types')
            .update({ parent_entity_type_id: newParentId })
            .eq('id', newEntityId);

          if (updateError) throw updateError;
        }
      }
    }

    // 6. Buscar e clonar fields
    console.log('  🔄 Clonando fields...');
    
    const { data: globalFields, error: fieldsError } = await supabase
      .from('extraction_fields')
      .select('*')
      .in('entity_type_id', Object.keys(entityTypeMapping))
      .order('sort_order');

    if (fieldsError) throw fieldsError;

    console.log(`  ✅ Fields encontrados: ${(globalFields || []).length}`);

    let fieldsCloned = 0;
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
          sort_order: globalField.sort_order,
          allowed_units: globalField.allowed_units
        });

      if (insertFieldError) throw insertFieldError;
      fieldsCloned++;
    }

    console.log(`  ✅ Total de ${fieldsCloned} fields clonados`);
    console.log('✅✅✅ IMPORT COMPLETO! ✅✅✅');

    return {
      success: true,
      templateId: projectTemplate.id,
      details: {
        entityTypesAdded: Object.keys(entityTypeMapping).length,
        fieldsAdded: fieldsCloned
      }
    };
  } catch (err: any) {
    console.error('❌ ERRO NO IMPORT:', err);
    return {
      success: false,
      error: err.message || 'Erro desconhecido'
    };
  }
}

// =================== FUNÇÃO HELPER: CRIAR INSTÂNCIAS INICIAIS ===================

/**
 * Cria extraction_instances iniciais para entity_types 'one'
 * 
 * Para cada entity_type com cardinality='one', cria uma instância
 * vinculada ao artigo. Isso facilita o preenchimento de campos.
 * 
 * Entity_types 'many' não criam instâncias automaticamente.
 */
export async function createInitialInstances(
  projectId: string,
  articleId: string,
  templateId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('📝 Criando instâncias iniciais...');

    // Buscar entity_types do template
    const { data: entityTypes, error: etError } = await supabase
      .from('extraction_entity_types')
      .select('id, name, label, cardinality, parent_entity_type_id')
      .eq('project_template_id', templateId)
      .eq('cardinality', 'one')
      .is('parent_entity_type_id', null); // Apenas ROOT com cardinality='one'

    if (etError) throw etError;

    // Criar instância para cada entity_type 'one'
    for (const et of entityTypes || []) {
      const { error: insertError } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          entity_type_id: et.id,
          parent_instance_id: null,
          label: et.label,
          sort_order: 0,
          created_by: userId
        });

      // Ignore duplicate errors (instância já existe)
      if (insertError && !insertError.message.includes('duplicate')) {
        throw insertError;
      }
    }

    console.log(`  ✅ Instâncias iniciais criadas`);

    return { success: true };
  } catch (err: any) {
    console.error('❌ Erro ao criar instâncias:', err);
    return {
      success: false,
      error: err.message
    };
  }
}



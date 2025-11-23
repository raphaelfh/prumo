/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

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
 * Fluxo com MERGE (preserva campos existentes):
 * 1. Verifica se já existe template ativo
 * 2. Se existe, faz MERGE no template existente (adiciona apenas o que não existe)
 * 3. Se não existe, cria novo template
 * 4. Preserva hierarquia (parent_entity_type_id)
 * 5. Adiciona apenas entity types e fields que não existem (comparando por nome)
 */
export async function importGlobalTemplate(
  projectId: string,
  globalTemplateId: string
): Promise<ImportResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    console.log('🚀 Importando template global (com MERGE)...');
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

    // 2. Buscar template ativo existente (se houver)
    const { data: existingTemplates } = await supabase
      .from('project_extraction_templates')
      .select('id, name')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .limit(1);

    let projectTemplate;
    let entityTypesExisting: any[] = [];
    let fieldsExisting: any[] = [];
    let isMerge = false;

    if (existingTemplates && existingTemplates.length > 0) {
      // MERGE: Usar template existente
      projectTemplate = existingTemplates[0];
      isMerge = true;
      console.log(`  🔄 Fazendo MERGE no template existente: ${projectTemplate.name}`);

      // Buscar entity types existentes
      const { data: existingEntityTypes, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('id, name, label')
        .eq('project_template_id', projectTemplate.id);

      if (etError) throw etError;
      entityTypesExisting = existingEntityTypes || [];

      // Buscar fields existentes (precisamos buscar todos para comparar depois)
      if (entityTypesExisting.length > 0) {
        const { data: existingFields, error: fieldsError } = await supabase
          .from('extraction_fields')
          .select('id, name, entity_type_id')
          .in('entity_type_id', entityTypesExisting.map(et => et.id));

        if (fieldsError) throw fieldsError;
        fieldsExisting = existingFields || [];
      }

      console.log(`  📊 Template existente: ${entityTypesExisting.length} entity types, ${fieldsExisting.length} fields`);
    } else {
      // Criar novo template
      const { data: newTemplate, error: projectTemplateError } = await supabase
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
      projectTemplate = newTemplate;
      console.log(`  ✅ Novo template criado: ${projectTemplate.id}`);
    }

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

    // 5. MERGE: Adicionar apenas entity types que não existem (2 passadas para preservar hierarquia)
    const entityTypeMapping: Record<string, string> = {};
    const existingEntityTypesByName = new Map(
      entityTypesExisting.map(et => [et.name, et.id])
    );

    let entityTypesAdded = 0;
    let entityTypesSkipped = 0;

    console.log(`  🔄 Fazendo MERGE de entity types (passada 1/2)...`);
    for (const globalEntity of globalEntityTypes) {
      // Verificar se já existe por nome
      const existingId = existingEntityTypesByName.get(globalEntity.name);
      
      if (existingId) {
        // Já existe, usar o existente
        entityTypeMapping[globalEntity.id] = existingId;
        entityTypesSkipped++;
        console.log(`    ⏭️  Entity type "${globalEntity.name}" já existe, mantendo existente`);
      } else {
        // Não existe, adicionar
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
        entityTypesAdded++;
        console.log(`    ✅ Entity type "${globalEntity.name}" adicionado`);
      }
    }

    console.log(`  📊 Entity types: ${entityTypesAdded} adicionados, ${entityTypesSkipped} mantidos`);

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

    // 6. MERGE: Adicionar apenas fields que não existem
    console.log('  🔄 Fazendo MERGE de fields...');
    
    const { data: globalFields, error: fieldsError } = await supabase
      .from('extraction_fields')
      .select('*')
      .in('entity_type_id', Object.keys(entityTypeMapping))
      .order('sort_order');

    if (fieldsError) throw fieldsError;

    console.log(`  ✅ Fields do template global: ${(globalFields || []).length}`);

    // Criar mapa de fields existentes por (entity_type_id, name)
    const existingFieldsByKey = new Map(
      fieldsExisting.map(f => [`${f.entity_type_id}:${f.name}`, f.id])
    );

    let fieldsAdded = 0;
    let fieldsSkipped = 0;

    for (const globalField of globalFields || []) {
      const newEntityTypeId = entityTypeMapping[globalField.entity_type_id];
      if (!newEntityTypeId) continue;

      // Verificar se field já existe neste entity type
      const fieldKey = `${newEntityTypeId}:${globalField.name}`;
      const existingFieldId = existingFieldsByKey.get(fieldKey);

      if (existingFieldId) {
        // Já existe, pular
        fieldsSkipped++;
        console.log(`    ⏭️  Field "${globalField.name}" já existe em ${globalField.entity_type_id}, mantendo existente`);
      } else {
        // Não existe, adicionar
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
            allowed_units: globalField.allowed_units,
            llm_description: globalField.llm_description,
            allow_other: globalField.allow_other ?? false,
            other_label: globalField.other_label ?? 'Outro (especificar)',
            other_placeholder: globalField.other_placeholder
          });

        if (insertFieldError) {
          console.error(`    ❌ Erro ao adicionar field "${globalField.name}":`, insertFieldError);
          throw insertFieldError;
        }

        fieldsAdded++;
        console.log(`    ✅ Field "${globalField.name}" adicionado`);
      }
    }

    console.log(`  📊 Fields: ${fieldsAdded} adicionados, ${fieldsSkipped} mantidos`);
    console.log(`✅✅✅ IMPORT ${isMerge ? 'MERGE' : 'COMPLETO'}! ✅✅✅`);

    return {
      success: true,
      templateId: projectTemplate.id,
      details: {
        entityTypesAdded: entityTypesAdded,
        fieldsAdded: fieldsAdded
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



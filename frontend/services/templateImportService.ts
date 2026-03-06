/**
 * Template import service - clean version
 *
 * Simplified and refactored to:
 * - Work only with entity_types (no template instances)
 * - Always preserve hierarchy
 * - Clean, production-ready code
 *
 * @module services/templateImportService
 */

import {supabase} from '@/integrations/supabase/client';
import {t} from '@/lib/copy';

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
 * Imports global template into the project
 *
 * Flow with MERGE (preserves existing fields):
 * 1. Check if active template already exists
 * 2. If exists, MERGE into existing template (add only what does not exist)
 * 3. If not, create new template
 * 4. Preserve hierarchy (parent_entity_type_id)
 * 5. Add only entity types and fields that do not exist (compare by name)
 */
export async function importGlobalTemplate(
  projectId: string,
  globalTemplateId: string
): Promise<ImportResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('common', 'errors_userNotAuthenticated'));

      console.log('🚀 Importing global template (with MERGE)...');
    console.log('  Project:', projectId);
    console.log('  Template:', globalTemplateId);

      // 1. Fetch global template
    const { data: globalTemplate, error: templateError } = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('id', globalTemplateId)
      .single();

    if (templateError) throw templateError;
      if (!globalTemplate) throw new Error(t('common', 'errors_templateNotFound'));

    console.log(`  ✅ Template: ${globalTemplate.name} v${globalTemplate.version}`);

      // 2. Fetch existing active template (if any)
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
        // MERGE: Use existing template
      projectTemplate = existingTemplates[0];
      isMerge = true;
        console.log(`  🔄 Merging into existing template: ${projectTemplate.name}`);

        // Fetch existing entity types
      const { data: existingEntityTypes, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('id, name, label')
        .eq('project_template_id', projectTemplate.id);

      if (etError) throw etError;
      entityTypesExisting = existingEntityTypes || [];

        // Fetch existing fields (need all to compare later)
      if (entityTypesExisting.length > 0) {
        const { data: existingFields, error: fieldsError } = await supabase
          .from('extraction_fields')
          .select('id, name, entity_type_id')
          .in('entity_type_id', entityTypesExisting.map(et => et.id));

        if (fieldsError) throw fieldsError;
        fieldsExisting = existingFields || [];
      }

        console.log(`  📊 Existing template: ${entityTypesExisting.length} entity types, ${fieldsExisting.length} fields`);
    } else {
        // Create new template
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

      // 4. Fetch entity_types from global template
    const { data: globalEntityTypes, error: entityTypesError } = await supabase
      .from('extraction_entity_types')
      .select('*')
      .eq('template_id', globalTemplateId)
      .is('project_template_id', null)
      .order('sort_order');

    if (entityTypesError) throw entityTypesError;
    if (!globalEntityTypes || globalEntityTypes.length === 0) {
        throw new Error(t('extraction', 'errors_templateHasNoEntityTypes'));
    }

    console.log(`  ✅ Entity types encontrados: ${globalEntityTypes.length}`);

      // 5. MERGE: Add only entity types that do not exist (2 passes to preserve hierarchy)
    const entityTypeMapping: Record<string, string> = {};
    const existingEntityTypesByName = new Map(
      entityTypesExisting.map(et => [et.name, et.id])
    );

    let entityTypesAdded = 0;
    let entityTypesSkipped = 0;

      console.log(`  🔄 Merging entity types (pass 1/2)...`);
    for (const globalEntity of globalEntityTypes) {
        // Check if already exists by name
      const existingId = existingEntityTypesByName.get(globalEntity.name);
      
      if (existingId) {
          // Already exists, use it
        entityTypeMapping[globalEntity.id] = existingId;
        entityTypesSkipped++;
          console.log(`    ⏭️  Entity type "${globalEntity.name}" already exists, keeping existing`);
      } else {
          // Does not exist, add
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
              // parent_entity_type_id: null for now
          })
          .select()
          .single();

        if (insertError) throw insertError;

        entityTypeMapping[globalEntity.id] = newEntity.id;
        entityTypesAdded++;
          console.log(`    ✅ Entity type "${globalEntity.name}" added`);
      }
    }

      console.log(`  📊 Entity types: ${entityTypesAdded} added, ${entityTypesSkipped} kept`);

      console.log('  🔄 Updating parent references (pass 2/2)...');
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

      // 6. MERGE: Add only fields that do not exist
      console.log('  🔄 Merging fields...');
    
    const { data: globalFields, error: fieldsError } = await supabase
      .from('extraction_fields')
      .select('*')
      .in('entity_type_id', Object.keys(entityTypeMapping))
      .order('sort_order');

    if (fieldsError) throw fieldsError;

      console.log(`  ✅ Global template fields: ${(globalFields || []).length}`);

      // Create map of existing fields by (entity_type_id, name)
    const existingFieldsByKey = new Map(
      fieldsExisting.map(f => [`${f.entity_type_id}:${f.name}`, f.id])
    );

    let fieldsAdded = 0;
    let fieldsSkipped = 0;

    for (const globalField of globalFields || []) {
      const newEntityTypeId = entityTypeMapping[globalField.entity_type_id];
      if (!newEntityTypeId) continue;

        // Check if field already exists in this entity type
      const fieldKey = `${newEntityTypeId}:${globalField.name}`;
      const existingFieldId = existingFieldsByKey.get(fieldKey);

      if (existingFieldId) {
          // Already exists, skip
        fieldsSkipped++;
          console.log(`    ⏭️  Field "${globalField.name}" already exists in ${globalField.entity_type_id}, keeping existing`);
      } else {
          // Does not exist, add
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
      console.log(`✅✅✅ IMPORT ${isMerge ? 'MERGE' : 'COMPLETE'}! ✅✅✅`);

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
        error: err.message || t('common', 'errors_unknownError')
    };
  }
}

// =================== FUNÇÃO HELPER: CRIAR INSTÂNCIAS INICIAIS ===================

/**
 * Creates initial extraction_instances for entity_types 'one'
 *
 * For each entity_type with cardinality='one', creates one instance
 * linked to the article. This facilitates field filling.
 *
 * Entity_types 'many' do not create instances automatically.
 */
export async function createInitialInstances(
  projectId: string,
  articleId: string,
  templateId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
      console.log('Creating initial instances...');

      // Fetch entity_types from template
    const { data: entityTypes, error: etError } = await supabase
      .from('extraction_entity_types')
      .select('id, name, label, cardinality, parent_entity_type_id')
      .eq('project_template_id', templateId)
      .eq('cardinality', 'one')
        .is('parent_entity_type_id', null); // Only ROOT with cardinality='one'

    if (etError) throw etError;

      // Create instance for each entity_type 'one'
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

        // Ignore duplicate errors (instance already exists)
      if (insertError && !insertError.message.includes('duplicate')) {
        throw insertError;
      }
    }

      console.log(`  ✅ Initial instances created`);

    return { success: true };
  } catch (err: any) {
      console.error('Error creating instances:', err);
    return {
      success: false,
      error: err.message
    };
  }
}



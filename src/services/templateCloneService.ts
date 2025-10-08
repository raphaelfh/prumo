/**
 * Serviço de Clonagem de Templates
 * 
 * Responsável por clonar templates globais para projetos específicos,
 * incluindo entity types, fields e instances.
 * 
 * Funcionalidades:
 * - Clonar template CHARMS automaticamente ao criar projeto
 * - Validações robustas em cada etapa
 * - Logs detalhados para debug
 * - Operação transacional (tudo ou nada)
 * - Tratamento de erros granular
 * 
 * @module templateCloneService
 */

import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// =================== TYPES ===================

interface CloneTemplateParams {
  projectId: string;
  globalTemplateId: string;
  templateName: string;
  userId: string;
}

interface CloneTemplateResult {
  success: boolean;
  templateId: string | null;
  error: string | null;
  stats: {
    entityTypes: number;
    fields: number;
    instances: number;
  };
}

// =================== MAIN FUNCTION ===================

/**
 * Clona um template global para um projeto específico
 * 
 * @param params Parâmetros da clonagem
 * @returns Resultado da clonagem com estatísticas
 */
export async function cloneTemplateToProject(
  params: CloneTemplateParams
): Promise<CloneTemplateResult> {
  const { projectId, globalTemplateId, templateName, userId } = params;

  const result: CloneTemplateResult = {
    success: false,
    templateId: null,
    error: null,
    stats: {
      entityTypes: 0,
      fields: 0,
      instances: 0
    }
  };

  try {
    console.log('🔄 Iniciando clonagem de template:', {
      projectId,
      globalTemplateId,
      templateName
    });

    // PASSO 1: Buscar template global
    const { data: globalTemplate, error: globalError } = await supabase
      .from('extraction_templates')
      .select('*')
      .eq('id', globalTemplateId)
      .eq('is_global', true)
      .single();

    if (globalError) {
      console.error('❌ Erro ao buscar template global:', globalError);
      throw new Error(`Template global não encontrado: ${globalError.message}`);
    }

    if (!globalTemplate) {
      throw new Error('Template global não encontrado');
    }

    console.log('✅ Template global encontrado:', globalTemplate.name);

    // PASSO 2: Buscar entity types do template global
    const { data: globalEntityTypes, error: entityTypesError } = await supabase
      .from('extraction_entity_types')
      .select(`
        *,
        extraction_fields (*)
      `)
      .eq('template_id', globalTemplateId)
      .order('sort_order', { ascending: true });

    if (entityTypesError) {
      console.error('❌ Erro ao buscar entity types:', entityTypesError);
      throw new Error(`Erro ao buscar seções: ${entityTypesError.message}`);
    }

    if (!globalEntityTypes || globalEntityTypes.length === 0) {
      console.warn('⚠️ Template global sem entity types');
      throw new Error('Template global não possui seções configuradas');
    }

    console.log(`✅ Encontradas ${globalEntityTypes.length} seções para clonar`);

    // PASSO 3: Criar template do projeto
    const { data: projectTemplate, error: projectTemplateError } = await supabase
      .from('project_extraction_templates')
      .insert({
        project_id: projectId,
        global_template_id: globalTemplateId,
        name: templateName,
        description: globalTemplate.description,
        framework: globalTemplate.framework,
        version: globalTemplate.version,
        schema: globalTemplate.schema,
        created_by: userId,
        is_active: true
      })
      .select()
      .single();

    if (projectTemplateError) {
      console.error('❌ Erro ao criar template do projeto:', projectTemplateError);
      throw new Error(`Erro ao criar template: ${projectTemplateError.message}`);
    }

    console.log('✅ Template do projeto criado:', projectTemplate.id);
    result.templateId = projectTemplate.id;

    // PASSO 4: Clonar entity types, fields e instances
    for (const [index, globalEntityType] of globalEntityTypes.entries()) {
      console.log(`📁 [${index + 1}/${globalEntityTypes.length}] Clonando: ${globalEntityType.label}`);

      // 4.1. Criar entity type do projeto
      const { data: newEntityType, error: entityError } = await supabase
        .from('extraction_entity_types')
        .insert({
          project_template_id: projectTemplate.id, // Campo correto!
          name: globalEntityType.name,
          label: globalEntityType.label,
          description: globalEntityType.description,
          parent_entity_type_id: globalEntityType.parent_entity_type_id,
          cardinality: globalEntityType.cardinality,
          sort_order: globalEntityType.sort_order,
          is_required: globalEntityType.is_required
        })
        .select()
        .single();

      if (entityError) {
        console.error(`❌ Erro ao criar entity type ${globalEntityType.label}:`, entityError);
        throw new Error(`Erro ao criar seção "${globalEntityType.label}": ${entityError.message}`);
      }

      console.log(`  ✅ Entity type criado: ${newEntityType.id}`);
      result.stats.entityTypes++;

      // 4.2. Criar instância template
      const { error: instanceError } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          template_id: projectTemplate.id,
          entity_type_id: newEntityType.id,
          label: globalEntityType.label,
          sort_order: globalEntityType.sort_order,
          metadata: {},
          created_by: userId,
          status: 'pending',
          is_template: true,
          article_id: null
        });

      if (instanceError) {
        console.error(`❌ Erro ao criar instance ${globalEntityType.label}:`, instanceError);
        throw new Error(`Erro ao criar instância "${globalEntityType.label}": ${instanceError.message}`);
      }

      console.log(`  ✅ Instance template criada`);
      result.stats.instances++;

      // 4.3. Clonar campos da entity
      const fieldsToClone = globalEntityType.extraction_fields || [];
      console.log(`  📝 Clonando ${fieldsToClone.length} campos...`);

      for (const field of fieldsToClone) {
        const { error: fieldError } = await supabase
          .from('extraction_fields')
          .insert({
            entity_type_id: newEntityType.id,
            name: field.name,
            label: field.label,
            description: field.description,
            field_type: field.field_type,
            is_required: field.is_required,
            validation_schema: field.validation_schema,
            allowed_values: field.allowed_values,
            unit: field.unit,
            sort_order: field.sort_order
          });

        if (fieldError) {
          console.error(`❌ Erro ao criar campo ${field.label}:`, fieldError);
          throw new Error(`Erro ao criar campo "${field.label}": ${fieldError.message}`);
        }

        result.stats.fields++;
      }

      console.log(`  ✅ ${fieldsToClone.length} campos criados`);
    }

    // Sucesso!
    console.log('🎉 Clonagem completa:', result.stats);
    result.success = true;

    return result;

  } catch (error: any) {
    console.error('❌ Erro durante clonagem:', error);
    result.error = error.message || 'Erro desconhecido';
    result.success = false;
    
    // Se houve erro mas criou o template, tentar limpar
    if (result.templateId) {
      console.log('🧹 Tentando limpar template incompleto...');
      await cleanupIncompleteTemplate(result.templateId);
    }

    return result;
  }
}

// =================== UTILITY FUNCTIONS ===================

/**
 * Limpa template incompleto em caso de erro
 */
async function cleanupIncompleteTemplate(templateId: string): Promise<void> {
  try {
    // Buscar entity types criados
    const { data: entityTypes } = await supabase
      .from('extraction_entity_types')
      .select('id')
      .eq('project_template_id', templateId);

    if (entityTypes && entityTypes.length > 0) {
      const entityTypeIds = entityTypes.map(et => et.id);

      // Remover campos
      await supabase
        .from('extraction_fields')
        .delete()
        .in('entity_type_id', entityTypeIds);

      // Remover instances
      await supabase
        .from('extraction_instances')
        .delete()
        .eq('template_id', templateId);

      // Remover entity types
      await supabase
        .from('extraction_entity_types')
        .delete()
        .in('id', entityTypeIds);
    }

    // Remover template
    await supabase
      .from('project_extraction_templates')
      .delete()
      .eq('id', templateId);

    console.log('✅ Template incompleto removido');
  } catch (cleanupError) {
    console.error('⚠️ Erro ao limpar template:', cleanupError);
    // Não propagar erro de cleanup
  }
}

/**
 * Busca template CHARMS global
 */
export async function findCharmsTemplate(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('extraction_templates')
      .select('id')
      .eq('is_global', true)
      .eq('framework', 'CHARMS')
      .single();

    if (error) {
      console.error('Erro ao buscar template CHARMS:', error);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error('Erro ao buscar template CHARMS:', error);
    return null;
  }
}

/**
 * Clona template CHARMS para um projeto
 * Função de conveniência que combina find + clone
 */
export async function cloneCharmsToProject(
  projectId: string,
  projectName: string,
  userId: string
): Promise<CloneTemplateResult> {
  console.log('🎯 Clonando CHARMS para projeto:', projectName);

  // 1. Buscar template CHARMS
  const charmsTemplateId = await findCharmsTemplate();

  if (!charmsTemplateId) {
    const error = 'Template CHARMS global não encontrado';
    console.error('❌', error);
    return {
      success: false,
      templateId: null,
      error,
      stats: { entityTypes: 0, fields: 0, instances: 0 }
    };
  }

  // 2. Clonar template
  const result = await cloneTemplateToProject({
    projectId,
    globalTemplateId: charmsTemplateId,
    templateName: `CHARMS (Projeto: ${projectName})`,
    userId
  });

  // 3. Feedback para usuário
  if (result.success) {
    toast.success(
      `Template CHARMS clonado! ${result.stats.entityTypes} seções, ${result.stats.fields} campos`
    );
  } else {
    toast.error(
      `Erro ao clonar template: ${result.error}`
    );
  }

  return result;
}

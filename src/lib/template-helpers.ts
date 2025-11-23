/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Helpers para validação e manipulação de templates
 * 
 * Garante que estamos usando os IDs corretos para templates:
 * - extraction_templates_global.id (templates globais CHARMS, PICOS, etc.)
 * - project_extraction_templates.id (instâncias do template no projeto)
 */

import { supabase } from '@/integrations/supabase/client';

/**
 * Valida se o templateId fornecido é de um project_extraction_templates
 * ao invés de extraction_templates_global
 */
export async function validateProjectTemplateId(templateId: string): Promise<{
  isValid: boolean;
  isProjectTemplate: boolean;
  isGlobalTemplate: boolean;
  error?: string;
}> {
  try {
    // Verificar se é um project template
    const { data: projectTemplate, error: projectError } = await supabase
      .from('project_extraction_templates')
      .select('id, name, is_active')
      .eq('id', templateId)
      .single();

    if (!projectError && projectTemplate) {
      return {
        isValid: true,
        isProjectTemplate: true,
        isGlobalTemplate: false,
      };
    }

    // Verificar se é um global template (não deveria ser usado para entity_types)
    const { data: globalTemplate, error: globalError } = await supabase
      .from('extraction_templates_global')
      .select('id, name')
      .eq('id', templateId)
      .single();

    if (!globalError && globalTemplate) {
      return {
        isValid: false,
        isProjectTemplate: false,
        isGlobalTemplate: true,
        error: `Template ID ${templateId} é um template global (${globalTemplate.name}). Use o ID do project_extraction_templates correspondente.`
      };
    }

    return {
      isValid: false,
      isProjectTemplate: false,
      isGlobalTemplate: false,
      error: `Template ID ${templateId} não encontrado em nenhuma tabela de templates.`
    };

  } catch (error: any) {
    return {
      isValid: false,
      isProjectTemplate: false,
      isGlobalTemplate: false,
      error: `Erro ao validar template: ${error.message}`
    };
  }
}

/**
 * Obtém informações detalhadas sobre o template para debug
 */
export async function getTemplateDebugInfo(templateId: string): Promise<{
  templateInfo?: any;
  entityTypesCount: number;
  fieldsCount: number;
  error?: string;
}> {
  try {
    // Buscar template
    const { data: template, error: templateError } = await supabase
      .from('project_extraction_templates')
      .select(`
        id,
        name,
        framework,
        version,
        is_active,
        created_at,
        global_template_id,
        extraction_templates_global(name, version)
      `)
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return {
        entityTypesCount: 0,
        fieldsCount: 0,
        error: `Template não encontrado: ${templateError?.message || 'ID inválido'}`
      };
    }

    // Contar entity types
    const { count: entityTypesCount, error: etError } = await supabase
      .from('extraction_entity_types')
      .select('*', { count: 'exact', head: true })
      .eq('project_template_id', templateId);

    if (etError) {
      console.warn('Erro ao contar entity types:', etError);
    }

    // Contar fields
    // Primeiro, buscar os IDs dos entity types
    const { data: entityTypeIds, error: etIdsError } = await supabase
      .from('extraction_entity_types')
      .select('id')
      .eq('project_template_id', templateId);

    let fieldsCount = 0;
    if (!etIdsError && entityTypeIds && entityTypeIds.length > 0) {
      const ids = entityTypeIds.map(et => et.id);
      const { count, error: fieldsError } = await supabase
        .from('extraction_fields')
        .select('*', { count: 'exact', head: true })
        .in('entity_type_id', ids);

      if (fieldsError) {
        console.warn('Erro ao contar fields:', fieldsError);
      } else {
        fieldsCount = count || 0;
      }
    } else if (etIdsError) {
      console.warn('Erro ao buscar IDs de entity types:', etIdsError);
    }

    return {
      templateInfo: {
        ...template,
        globalTemplateName: template.extraction_templates_global?.name,
        globalTemplateVersion: template.extraction_templates_global?.version,
      },
      entityTypesCount: entityTypesCount || 0,
      fieldsCount: fieldsCount || 0,
    };

  } catch (error: any) {
    return {
      entityTypesCount: 0,
      fieldsCount: 0,
      error: `Erro ao obter informações do template: ${error.message}`
    };
  }
}

/**
 * Log estruturado para debug de templates
 */
export function logTemplateDebug(
  context: string,
  templateId: string,
  additionalInfo?: any
): void {
  console.group(`🔍 [${context}] Debug Template`);
  console.log('Template ID:', templateId);
  console.log('Timestamp:', new Date().toISOString());
  
  if (additionalInfo) {
    console.log('Informações adicionais:', additionalInfo);
  }
  
  console.groupEnd();
}

/**
 * Garante que estamos usando project_template_id nas queries
 * 
 * @deprecated Use validateProjectTemplateId() para validação mais robusta
 */
export function ensureProjectTemplateId(templateId: string): void {
  console.warn('ensureProjectTemplateId() está deprecated. Use validateProjectTemplateId() para validação completa.');
  
  if (!templateId) {
    throw new Error('Template ID não pode ser vazio');
  }
  
  // Log básico para debug
  console.log(`🔍 Template ID sendo usado: ${templateId}`);
}

/**
 * Obtém o template ativo de um projeto
 */
export async function getActiveProjectTemplate(projectId: string): Promise<{
  template?: any;
  error?: string;
}> {
  try {
    const { data: template, error } = await supabase
      .from('project_extraction_templates')
      .select(`
        *,
        extraction_templates_global(name, version, framework)
      `)
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single();

    if (error) {
      return { error: error.message };
    }

    if (!template) {
      return { error: 'Nenhum template ativo encontrado para este projeto' };
    }

    return { template };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * Verifica se o projeto tem template configurado
 */
export async function hasActiveTemplate(projectId: string): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('project_extraction_templates')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('is_active', true);

    return !error && (count || 0) > 0;
  } catch {
    return false;
  }
}

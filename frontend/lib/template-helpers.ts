/**
 * Helpers for template validation and manipulation
 *
 * Ensures we use the correct template IDs:
 * - extraction_templates_global.id (global templates CHARMS, PICOS, etc.)
 * - project_extraction_templates.id (template instances in the project)
 */

import {supabase} from '@/integrations/supabase/client';

/**
 * Validates that the given templateId is from project_extraction_templates
 * rather than extraction_templates_global
 */
export async function validateProjectTemplateId(templateId: string): Promise<{
  isValid: boolean;
  isProjectTemplate: boolean;
  isGlobalTemplate: boolean;
  error?: string;
}> {
  try {
      // Check if it is a project template
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

      // Check if it is a global template (should not be used for entity_types)
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
          error: `Template ID ${templateId} is a global template (${globalTemplate.name}). Use the corresponding project_extraction_templates ID.`
      };
    }

    return {
      isValid: false,
      isProjectTemplate: false,
      isGlobalTemplate: false,
        error: `Template ID ${templateId} not found in any template table.`
    };

  } catch (error: any) {
    return {
      isValid: false,
      isProjectTemplate: false,
      isGlobalTemplate: false,
        error: `Error validating template: ${error.message}`
    };
  }
}

/**
 * Gets detailed template info for debug
 */
export async function getTemplateDebugInfo(templateId: string): Promise<{
  templateInfo?: any;
  entityTypesCount: number;
  fieldsCount: number;
  error?: string;
}> {
  try {
      // Fetch template
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
          error: `Template not found: ${templateError?.message || 'Invalid ID'}`
      };
    }

      // Count entity types
    const { count: entityTypesCount, error: etError } = await supabase
      .from('extraction_entity_types')
      .select('*', { count: 'exact', head: true })
      .eq('project_template_id', templateId);

    if (etError) {
        console.warn('Error counting entity types:', etError);
    }

      // Count fields
      // First, fetch entity type IDs
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
          console.warn('Error counting fields:', fieldsError);
      } else {
        fieldsCount = count || 0;
      }
    } else if (etIdsError) {
        console.warn('Error fetching entity type IDs:', etIdsError);
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
        error: `Error getting template info: ${error.message}`
    };
  }
}

/**
 * Structured log for template debug
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
      console.log('Additional info:', additionalInfo);
  }
  
  console.groupEnd();
}

/**
 * Ensures we use project_template_id in queries
 *
 * @deprecated Use validateProjectTemplateId() for more robust validation
 */
export function ensureProjectTemplateId(templateId: string): void {
    console.warn('ensureProjectTemplateId() is deprecated. Use validateProjectTemplateId() for full validation.');
  
  if (!templateId) {
      throw new Error('Template ID cannot be empty');
  }

    // Basic log for debug
    console.log(`🔍 Template ID in use: ${templateId}`);
}

/**
 * Gets the active template for a project
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
        return {error: 'No active template found for this project'};
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

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
import {apiClient} from '@/integrations/api/client';
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

interface CloneTemplateResponse {
  project_template_id: string;
  version_id: string;
  entity_type_count: number;
  field_count: number;
  created: boolean;
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

      console.warn('🚀 Importing global template (with MERGE)...');
      console.warn('  Project:', projectId);
      console.warn('  Template:', globalTemplateId);

      // 1. Fetch global template
    const { data: globalTemplate, error: templateError } = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('id', globalTemplateId)
      .single();

    if (templateError) throw templateError;
      if (!globalTemplate) throw new Error(t('common', 'errors_templateNotFound'));

      console.warn(`  ✅ Template: ${globalTemplate.name} v${globalTemplate.version}`);

    const serverCloneResult = await apiClient<CloneTemplateResponse>(
      `/api/v1/projects/${projectId}/templates/clone`,
      {
        method: 'POST',
        body: { global_template_id: globalTemplateId, kind: 'extraction' },
      },
    );

    return {
      success: true,
      templateId: serverCloneResult.project_template_id,
      details: {
        entityTypesAdded: serverCloneResult.entity_type_count,
        fieldsAdded: serverCloneResult.field_count,
      },
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
      console.warn('Creating initial instances...');

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

      console.warn(`  ✅ Initial instances created`);

    return { success: true };
  } catch (err: any) {
      console.error('Error creating instances:', err);
    return {
      success: false,
      error: err.message
    };
  }
}



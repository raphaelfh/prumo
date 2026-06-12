/**
 * Extraction data service — parallel Phase-1 reads for ExtractionFullScreen.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler.
 *
 * @module services/extractionDataService
 */

import {supabase} from '@/integrations/supabase/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {Article} from '@/types/article';
import type {Project} from '@/types/project';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionField,
  ProjectExtractionTemplate,
} from '@/types/extraction';

// ---------------------------------------------------------------------------
// Phase-1 parallel load: article + project + template + navigation articles
// ---------------------------------------------------------------------------

export interface ExtractionPhase1Result {
  article: Article;
  project: Project;
  template: ProjectExtractionTemplate;
  articles: Article[];
}

/**
 * Load the four independent data sources for ExtractionFullScreen in a
 * single Promise.all. Throws on any error so the caller can surface a
 * single toast.
 *
 * Template selection: newest active extraction template (created_at DESC)
 * so this matches ExtractionInterface's active picker.
 */
export function loadExtractionPhase1(
  articleId: string,
  projectId: string,
  noTemplateMessage: string,
): Promise<ErrorResult<ExtractionPhase1Result>> {
  return toResult(async () => {
    const [
      {data: articleData, error: articleError},
      {data: projectData, error: projectError},
      {data: templateData, error: templateError},
      {data: articlesData, error: articlesError},
    ] = await Promise.all([
      supabase.from('articles').select('*').eq('id', articleId).single(),
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .eq('kind', 'extraction')
        .order('created_at', {ascending: false})
        .limit(1)
        .maybeSingle(),
      supabase
        .from('articles')
        .select('id, title')
        .eq('project_id', projectId)
        .order('created_at', {ascending: false}),
    ]);

    if (articleError) throw articleError;
    if (projectError) throw projectError;
    if (templateError) throw templateError;
    if (articlesError) throw articlesError;
    if (!templateData) throw new Error(noTemplateMessage);

    return {
      article: articleData as Article,
      project: projectData as Project,
      template: templateData as ProjectExtractionTemplate,
      articles: (articlesData ?? []) as Article[],
    };
  }, 'loadExtractionPhase1');
}

// ---------------------------------------------------------------------------
// Phase-2: entity types with fields (depends on resolved template id)
// ---------------------------------------------------------------------------

/**
 * Load entity types with their nested fields for a project template.
 * Ordered by sort_order ascending.
 */
export function loadEntityTypesWithFields(
  templateId: string,
): Promise<ErrorResult<ExtractionEntityTypeWithFields[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('extraction_entity_types')
      .select(`
        *,
        fields:extraction_fields(*)
      `)
      .eq('project_template_id', templateId)
      .order('sort_order', {ascending: true});

    if (error) throw error;

    return (data ?? []).map((et) => ({
      ...et,
      template_id: et.template_id!,
      fields: ((et.fields ?? []) as ExtractionField[]).map((field) => ({
        ...field,
        allowed_values: field.allowed_values as string[] | null,
        allowed_units: field.allowed_units as string[] | null,
        validation_schema: field.validation_schema as unknown,
      })),
    })) as ExtractionEntityTypeWithFields[];
  }, 'loadEntityTypesWithFields');
}

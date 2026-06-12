/**
 * Template structure CRUD service (entity-types, sections).
 *
 * IO for template configuration: loading entity types, updating labels,
 * adding/removing sections, creating custom templates.  Article-list
 * queries live in articlesService.ts; auth queries in authService.ts.
 *
 * All exported functions return ErrorResult<T> via toResult so components
 * can branch on result.ok without try/catch.
 *
 * @module services/templateService
 */

import {supabase} from '@/integrations/supabase/client';
import type {ErrorResult} from '@/lib/error-utils';
import {toResult} from '@/lib/error-utils';

// --- Types ---

export interface EntityTypeWithCount {
  id: string;
  template_id: string;
  name: string;
  label: string;
  description?: string | null;
  cardinality: 'one' | 'many';
  sort_order: number;
  parent_entity_type_id?: string | null;
  role?: string;
  is_required?: boolean;
  created_at?: string;
  fieldsCount: number;
  [key: string]: unknown;
}

export interface SectionImpact {
  fieldsCount: number;
  instancesCount: number;
  dataCount: number;
  canDelete: boolean;
  warnings: string[];
}

// --- Entity type loading ---

/**
 * Load all entity types for a template with their field counts.
 * Single-query relocation: no test needed.
 */
export async function loadTemplateEntityTypes(
  templateId: string,
): Promise<ErrorResult<EntityTypeWithCount[]>> {
  return toResult(async () => {
    const {data: entityTypesData, error: entityTypesError} = await supabase
      .from('extraction_entity_types')
      .select('*, extraction_fields(count)')
      .eq('project_template_id', templateId)
      .order('sort_order', {ascending: true});

    if (entityTypesError) throw entityTypesError;

    const entityTypesWithCounts = await Promise.all(
      (entityTypesData || []).map(async (et) => {
        const {count, error: countError} = await supabase
          .from('extraction_fields')
          .select('*', {count: 'exact', head: true})
          .eq('entity_type_id', et.id);

        if (countError) {
          console.error(`Error counting fields for ${et.name}:`, countError);
        }

        return {
          ...et,
          fieldsCount: count || 0,
        } as EntityTypeWithCount;
      }),
    );

    return entityTypesWithCounts;
  }, 'loadTemplateEntityTypes');
}

// --- Entity type label update ---

/**
 * Update the label of an entity type (section rename).
 * NOTE: on success the caller should show a toast using the extraction
 * 'labelUpdatedSuccess' copy key.
 */
export async function updateEntityTypeLabel(
  entityTypeId: string,
  label: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('extraction_entity_types')
      .update({label})
      .eq('id', entityTypeId);

    if (error) throw error;
  }, 'updateEntityTypeLabel');
}

// --- Section removal impact analysis ---

/**
 * Analyze the impact of removing a section (entity type).
 * Returns field/instance/data counts and warnings so the component can
 * present them before the user confirms.
 */
export async function analyzeSectionRemovalImpact(
  entityTypeId: string,
): Promise<ErrorResult<SectionImpact>> {
  return toResult(async () => {
    // Count section fields
    const {count: fieldsCount, error: fieldsError} = await supabase
      .from('extraction_fields')
      .select('id', {count: 'exact', head: true})
      .eq('entity_type_id', entityTypeId);

    if (fieldsError) throw fieldsError;

    // Count section instances
    const {count: instancesCount, error: instancesError} = await supabase
      .from('extraction_instances')
      .select('id', {count: 'exact', head: true})
      .eq('entity_type_id', entityTypeId);

    if (instancesError) throw instancesError;

    // Count non-reject reviewer decisions tied to instances of this type
    const {data: typeInstances} = await supabase
      .from('extraction_instances')
      .select('id')
      .eq('entity_type_id', entityTypeId);
    const typeInstanceIds = (typeInstances || []).map((i) => i.id);
    let dataCount = 0;
    if (typeInstanceIds.length > 0) {
      const {count, error: dataError} = await supabase
        .from('extraction_reviewer_decisions')
        .select('id', {count: 'exact', head: true})
        .in('instance_id', typeInstanceIds)
        .neq('decision', 'reject');
      if (dataError) {
        console.warn('Could not count reviewer decisions:', dataError);
      } else {
        dataCount = count ?? 0;
      }
    }

    return {
      fieldsCount: fieldsCount || 0,
      instancesCount: instancesCount || 0,
      dataCount,
      canDelete: true,
      warnings: [], // Caller builds warnings from counts + copy keys
    } satisfies SectionImpact;
  }, 'analyzeSectionRemovalImpact');
}

// --- Section deletion ---

/**
 * Delete an entity type (CASCADE removes fields, instances, values).
 * NOTE: caller toasts success/error using extraction copy keys.
 */
export async function deleteSection(
  entityTypeId: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase
      .from('extraction_entity_types')
      .delete()
      .eq('id', entityTypeId);

    if (error) throw error;
  }, 'deleteSection');
}

// --- Custom template creation ---

export interface CreateCustomTemplateParams {
  projectId: string;
  name: string;
  description?: string | null;
  framework: 'CUSTOM' | 'CHARMS' | 'PICOS';
  createdBy: string;
}

export interface CreatedTemplate {
  id: string;
  name: string;
}

/**
 * Insert a new project_extraction_templates row.
 * NOTE: caller toasts success ("${name}" created) + info (add sections).
 */
export async function createCustomTemplate(
  params: CreateCustomTemplateParams,
): Promise<ErrorResult<CreatedTemplate>> {
  return toResult(async () => {
    const {data: template, error} = await supabase
      .from('project_extraction_templates')
      .insert({
        project_id: params.projectId,
        name: params.name,
        description: params.description,
        framework: params.framework,
        version: '1.0.0',
        schema: {
          description: params.description || '',
          custom: true,
          created_via_ui: true,
        },
        is_active: true,
        created_by: params.createdBy,
      })
      .select()
      .single();

    if (error) throw error;

    return {id: template.id, name: template.name} satisfies CreatedTemplate;
  }, 'createCustomTemplate');
}

// --- Global templates ---

export interface GlobalTemplateWithCount {
  id: string;
  name: string;
  framework: 'CHARMS' | 'PICOS' | 'CUSTOM';
  description: string | null;
  version: string | null;
  is_global: boolean;
  schema: unknown;
  created_at: string | null;
  updated_at: string | null;
  entityTypesCount: number;
}

/**
 * Load all global extraction templates with entity-type counts.
 * Single round-trip: counts computed client-side over the flat entity-type
 * rows (tiny set, far cheaper than N per-template count queries).
 */
export function loadGlobalTemplates(): Promise<ErrorResult<GlobalTemplateWithCount[]>> {
  return toResult(async () => {
    const {data: templatesData, error: templatesError} = await supabase
      .from('extraction_templates_global')
      .select('*')
      .eq('is_global', true)
      .order('framework', {ascending: true});

    if (templatesError) throw templatesError;

    if (!templatesData || templatesData.length === 0) return [];

    const templateIds = templatesData.map((t) => t.id);
    const {data: entityTypeRows, error: countError} = await supabase
      .from('extraction_entity_types')
      .select('template_id')
      .in('template_id', templateIds);

    if (countError) throw countError;

    const countByTemplateId = new Map<string, number>();
    for (const row of entityTypeRows ?? []) {
      const tid = (row as {template_id: string}).template_id;
      countByTemplateId.set(tid, (countByTemplateId.get(tid) ?? 0) + 1);
    }

    return templatesData.map((template) => ({
      id: template.id,
      name: template.name,
      framework: template.framework as 'CHARMS' | 'PICOS' | 'CUSTOM',
      description: template.description,
      version: template.version,
      is_global: template.is_global,
      schema: template.schema,
      created_at: template.created_at,
      updated_at: template.updated_at,
      entityTypesCount: countByTemplateId.get(template.id) ?? 0,
    }));
  }, 'loadGlobalTemplates');
}

// --- Section creation ---

export interface CreateSectionParams {
  templateId: string;
  name: string;
  label: string;
  description?: string | null;
  cardinality: 'one' | 'many';
  isRequired: boolean;
}

/**
 * Insert a new root entity type into a template (fetches next sort_order first).
 * NOTE: caller toasts success using extraction 'sectionCreatedSuccess' copy key.
 */
export async function createSection(
  params: CreateSectionParams,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    // Fetch next sort_order
    const {data: existing, error: orderError} = await supabase
      .from('extraction_entity_types')
      .select('sort_order')
      .eq('project_template_id', params.templateId)
      .order('sort_order', {ascending: false})
      .limit(1);

    if (orderError) throw orderError;

    const nextSortOrder = (existing?.[0]?.sort_order || 0) + 1;

    const {error: entityError} = await supabase
      .from('extraction_entity_types')
      .insert({
        project_template_id: params.templateId,
        name: params.name,
        label: params.label,
        description: params.description || null,
        cardinality: params.cardinality,
        sort_order: nextSortOrder,
        is_required: params.isRequired,
        parent_entity_type_id: null,
        role: 'study_section' as const,
      });

    if (entityError) throw entityError;
  }, 'createSection');
}


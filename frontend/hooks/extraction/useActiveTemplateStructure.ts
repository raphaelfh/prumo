/**
 * ACTIVE-version template structure for worklist/dashboard progress
 * (track B, slice B-3a).
 *
 * Replaces the live PostgREST read for the three worklist surfaces; the
 * config editor keeps `useTemplateEntityTypes` (it must show the draft
 * once B-4 lands). Cached on its own key, which `useTemplateRepublish`
 * invalidates alongside the live one.
 */
import {useQuery} from '@tanstack/react-query';

import {templateActiveStructureKeys} from '@/lib/query-keys/extraction';
import {getActiveTemplateStructure} from '@/services/templateStructureService';
import type {ExtractionField} from '@/types/extraction';

import type {TemplateEntityTypeWithFields} from './useTemplateEntityTypes';

export function useActiveTemplateStructure(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
) {
  const query = useQuery({
    queryKey: templateActiveStructureKeys.byTemplate(
      projectId ?? '',
      templateId ?? '',
    ),
    enabled: !!projectId && !!templateId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TemplateEntityTypeWithFields[]> => {
      const read = await getActiveTemplateStructure(
        projectId as string,
        templateId as string,
      );
      // B-3b (disclosed change): entity-level `is_required` passes
      // through, activating progress.ts's template-driven phantom-slot
      // logic — a REQUIRED cardinality='many' section with zero
      // instances now blocks 100% in the worklist/dashboard, matching
      // the form header (which already threads the flag from the
      // run-pinned snapshot). Deliberately stricter than the backend
      // finalize gate, which counts required fields per EXISTING
      // instance only.
      return read.entity_types.map((et) => ({
        id: et.id,
        name: et.name,
        label: et.label ?? null,
        description: et.description ?? null,
        role: et.role ?? null,
        cardinality: et.cardinality ?? null,
        parent_entity_type_id: et.parent_entity_type_id ?? null,
        sort_order: et.sort_order ?? 0,
        is_required: et.is_required,
        fields: (et.fields ?? []) as unknown as ExtractionField[],
      }));
    },
  });

  return {
    entityTypes: query.data ?? [],
    // isPending, not query.isLoading: "no data yet" must read as loading even
    // while TanStack pauses a query it considers offline (networkMode
    // 'online' + connection refused ends in status pending/fetchStatus
    // paused, where isLoading is false).
    isLoading: query.isPending,
    // Consumers must treat an error like loading (placeholder) — an empty
    // tree computes as fully-complete progress, which is worse than a spinner.
    isError: query.isError,
    error: query.error,
  };
}

// frontend/services/projectsService.ts
/**
 * Projects service — IO for the project list/navigation surfaces.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. Supabase reads are relocated verbatim from hooks (no
 * new reads); the data-path consolidation owns the typed-client swap.
 */
import {supabase} from '@/integrations/supabase/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {ProjectListItem} from '@/types/project';

export function listProjects(): Promise<ErrorResult<ProjectListItem[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select('*')
      .order('created_at', {ascending: false});
    if (error) throw error;
    return data ?? [];
  }, 'projectsService.listProjects');
}

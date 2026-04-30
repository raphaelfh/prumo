/**
 * Read-only list of project members for the arbitrator picker.
 *
 * Goes through the existing ``get_project_members`` Supabase RPC
 * (already used by the Team section) so we get name + avatar in a
 * single round-trip. Filtering by role is done client-side because
 * RPC arguments don't accept arrays today.
 */

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { MemberRole } from '@/types/project';

export interface ProjectMemberSummary {
  user_id: string;
  role: MemberRole;
  user_email: string | null;
  user_full_name: string | null;
  user_avatar_url: string | null;
}

interface RpcRow {
  id: string;
  user_id: string;
  role: MemberRole;
  user_email: string | null;
  user_full_name: string | null;
  user_avatar_url: string | null;
}

export const projectMembersKeys = {
  all: ['project-members'] as const,
  byProject: (projectId: string) =>
    [...projectMembersKeys.all, projectId] as const,
};

export function useProjectMembers(projectId: string | null | undefined) {
  return useQuery<ProjectMemberSummary[]>({
    queryKey: projectId
      ? projectMembersKeys.byProject(projectId)
      : ['project-members', 'disabled'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_project_members', {
        p_project_id: projectId!,
      });
      if (error) throw error;
      return ((data as RpcRow[]) ?? []).map((row) => ({
        user_id: row.user_id,
        role: row.role,
        user_email: row.user_email,
        user_full_name: row.user_full_name,
        user_avatar_url: row.user_avatar_url,
      }));
    },
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

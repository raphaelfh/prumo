/**
 * Hook to manage project list
 * Reusable between desktop and mobile sidebar
 */

import {useCallback, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {ProjectListItem} from '@/types/project';

export const useProjectsList = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error: any) {
        toast.error(t('pages', 'dashboardCouldNotLoadProjects'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const switchProject = useCallback((projectId: string) => {
    navigate(`/projects/${projectId}`);
  }, [navigate]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return {
    projects,
    loading,
    loadProjects,
    switchProject,
  };
};

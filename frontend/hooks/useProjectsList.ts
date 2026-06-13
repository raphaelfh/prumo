/**
 * Hook to manage project list
 * Reusable between desktop and mobile sidebar
 */

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {listProjects} from '@/services/projectsService';
import type {ProjectListItem} from '@/types/project';

export const useProjectsList = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProjects = async () => {
    setLoading(true);
    const result = await listProjects();
    if (result.ok) {
      setProjects(result.data);
    } else {
      toast.error(t('pages', 'dashboardCouldNotLoadProjects'));
      console.error(result.error);
    }
    setLoading(false);
  };

  const switchProject = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadProjects());
  }, [loadProjects]);

  return {
    projects,
    loading,
    loadProjects,
    switchProject,
  };
};

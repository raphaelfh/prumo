/**
 * Project + global templates for the HITL flows (extraction & quality
 * assessment). Generalises ``useExtractionTemplates`` and the now-deleted
 * ``useGlobalQATemplates`` into one kind-parametrised hook.
 *
 * - ``templates`` lists ``project_extraction_templates`` rows for the
 *   project filtered by ``kind``. Default: only ``is_active=true``; pass
 *   ``includeInactive`` to see the full set (the QA Configuration tab
 *   needs this to render disabled toggles for previously-imported tools).
 * - ``globalTemplates`` lists every global template of the same kind so
 *   the Configuration UI can offer them for import.
 * - ``cloneTemplate`` and ``setTemplateActive`` go through the new
 *   ``/api/v1/projects/:id/templates`` endpoints, replacing the inline
 *   Supabase clone the old ``useExtractionTemplates`` did. Single source
 *   of truth lives server-side in ``template_clone_service``.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { supabase } from "@/integrations/supabase/client";
import { t } from "@/lib/copy";

export type HITLKind = "extraction" | "quality_assessment";

export interface ProjectTemplate {
  id: string;
  project_id: string;
  global_template_id: string | null;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  kind: HITLKind;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

export interface GlobalTemplate {
  id: string;
  name: string;
  description: string | null;
  framework: string;
  version: string;
  kind: HITLKind;
}

interface CloneResponse {
  project_template_id: string;
  version_id: string;
  entity_type_count: number;
  field_count: number;
  created: boolean;
}

interface UpdateActiveResponse {
  project_template_id: string;
  is_active: boolean;
}

interface UseHITLProjectTemplatesProps {
  projectId: string;
  kind: HITLKind;
  includeInactive?: boolean;
}

interface UseHITLProjectTemplatesResult {
  templates: ProjectTemplate[];
  globalTemplates: GlobalTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ProjectTemplate[]>;
  cloneTemplate: (globalTemplateId: string) => Promise<ProjectTemplate | null>;
  setTemplateActive: (templateId: string, isActive: boolean) => Promise<boolean>;
  isTemplateImported: (globalTemplateId: string) => boolean;
}

export function useHITLProjectTemplates({
  projectId,
  kind,
  includeInactive = false,
}: UseHITLProjectTemplatesProps): UseHITLProjectTemplatesResult {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [globalTemplates, setGlobalTemplates] = useState<GlobalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectTemplates = useCallback(async (): Promise<ProjectTemplate[]> => {
    let query = supabase
      .from("project_extraction_templates")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .order("created_at", { ascending: false });
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }
    const { data, error: queryError } = await query;
    if (queryError) throw queryError;
    return (data ?? []) as ProjectTemplate[];
  }, [projectId, kind, includeInactive]);

  const fetchGlobalTemplates = useCallback(async (): Promise<GlobalTemplate[]> => {
    const { data, error: queryError } = await supabase
      .from("extraction_templates_global")
      .select("id, name, description, framework, version, kind")
      .eq("kind", kind)
      .order("name", { ascending: true });
    if (queryError) throw queryError;
    return (data ?? []) as GlobalTemplate[];
  }, [kind]);

  useEffect(() => {
    if (!projectId) {
      setTemplates([]);
      setGlobalTemplates([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [project, global] = await Promise.all([
          fetchProjectTemplates(),
          fetchGlobalTemplates(),
        ]);
        if (!cancelled) {
          setTemplates(project);
          setGlobalTemplates(global);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load templates");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, fetchProjectTemplates, fetchGlobalTemplates]);

  const refresh = useCallback(async (): Promise<ProjectTemplate[]> => {
    if (!projectId) return [];
    try {
      const project = await fetchProjectTemplates();
      setTemplates(project);
      return project;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh templates";
      setError(message);
      throw err;
    }
  }, [projectId, fetchProjectTemplates]);

  const cloneTemplate = useCallback(
    async (globalTemplateId: string): Promise<ProjectTemplate | null> => {
      try {
        const result = await apiClient<CloneResponse>(
          `/api/v1/projects/${projectId}/templates/clone`,
          {
            method: "POST",
            body: { global_template_id: globalTemplateId, kind },
          },
        );
        const refreshed = await refresh();
        const created = refreshed.find((tpl) => tpl.id === result.project_template_id);
        if (result.created) {
          toast.success(t("extraction", "templateClonedSuccess").replace("{{name}}", created?.name ?? ""));
        }
        return created ?? null;
      } catch (err) {
        toast.error(`${t("extraction", "errors_cloneTemplate")}: ${
          err instanceof Error ? err.message : "unknown error"
        }`);
        return null;
      }
    },
    [projectId, kind, refresh],
  );

  const setTemplateActive = useCallback(
    async (templateId: string, isActive: boolean): Promise<boolean> => {
      try {
        await apiClient<UpdateActiveResponse>(
          `/api/v1/projects/${projectId}/templates/${templateId}`,
          {
            method: "PATCH",
            body: { is_active: isActive },
          },
        );
        await refresh();
        toast.success(
          t(
            "extraction",
            isActive ? "templateActivatedSuccess" : "templateDeactivatedSuccess",
          ),
        );
        return true;
      } catch (err) {
        toast.error(`${t("extraction", "errors_updateTemplateStatus")}: ${
          err instanceof Error ? err.message : "unknown error"
        }`);
        return false;
      }
    },
    [projectId, refresh],
  );

  const isTemplateImported = useCallback(
    (globalTemplateId: string): boolean =>
      templates.some(
        (tpl) => tpl.global_template_id === globalTemplateId && tpl.is_active,
      ),
    [templates],
  );

  return {
    templates,
    globalTemplates,
    loading,
    error,
    refresh,
    cloneTemplate,
    setTemplateActive,
    isTemplateImported,
  };
}

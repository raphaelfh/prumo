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
import {
  fetchGlobalTemplates,
  fetchProjectTemplates,
} from "@/services/qaTemplateService";
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
  // Only show the loader when there is actually something to load.
  const [loading, setLoading] = useState(() => Boolean(projectId));
  const [error, setError] = useState<string | null>(null);

  // Reset when the query coordinates change (during render, so the fetch
  // effect below never sets state synchronously).
  const [prevKey, setPrevKey] = useState({ projectId, kind, includeInactive });
  if (
    projectId !== prevKey.projectId ||
    kind !== prevKey.kind ||
    includeInactive !== prevKey.includeInactive
  ) {
    setPrevKey({ projectId, kind, includeInactive });
    if (projectId) {
      setLoading(true);
      setError(null);
    } else {
      setTemplates([]);
      setGlobalTemplates([]);
      setLoading(false);
    }
  }

  const refresh = useCallback(async (): Promise<ProjectTemplate[]> => {
    if (!projectId) return [];
    const result = await fetchProjectTemplates(projectId, kind, includeInactive);
    if (result.ok) {
      setTemplates(result.data as ProjectTemplate[]);
      return result.data as ProjectTemplate[];
    }
    setError(result.error.message);
    throw result.error;
  }, [projectId, kind, includeInactive]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    // Microtask so the fetch's setState calls run in async callbacks
    // (the loading/error reset happens during render above).
    queueMicrotask(() => void (async () => {
      const [projectResult, globalResult] = await Promise.all([
        fetchProjectTemplates(projectId, kind, includeInactive),
        fetchGlobalTemplates(kind),
      ]);
      if (cancelled) return;
      if (projectResult.ok && globalResult.ok) {
        setTemplates(projectResult.data as ProjectTemplate[]);
        setGlobalTemplates(globalResult.data as GlobalTemplate[]);
      } else {
        const err = projectResult.ok ? globalResult : projectResult;
        if (!err.ok) setError(err.error.message);
      }
      setLoading(false);
    })());
    return () => {
      cancelled = true;
    };
  }, [projectId, kind, includeInactive, refresh]);

  const cloneTemplate = useCallback(
    async (globalTemplateId: string): Promise<ProjectTemplate | null> => {
      const result = await (async () => {
        const data = await apiClient<CloneResponse>(
          `/api/v1/projects/${projectId}/templates/clone`,
          {
            method: "POST",
            body: { global_template_id: globalTemplateId, kind },
          },
        );
        return data;
      })().then(
        (data) => ({ ok: true as const, data }),
        (err: unknown) => ({ ok: false as const, error: err }),
      );

      if (!result.ok) {
        const err = result.error;
        toast.error(`${t("extraction", "errors_cloneTemplate")}: ${
          err instanceof Error ? err.message : "unknown error"
        }`);
        return null;
      }

      const refreshed = await refresh().catch(() => [] as ProjectTemplate[]);
      const created = refreshed.find((tpl) => tpl.id === result.data.project_template_id);
      if (result.data.created) {
        toast.success(t("extraction", "templateClonedSuccess").replace("{{name}}", created?.name ?? ""));
      }
      return created ?? null;
    },
    [projectId, kind, refresh],
  );

  const setTemplateActive = useCallback(
    async (templateId: string, isActive: boolean): Promise<boolean> => {
      const result = await apiClient<UpdateActiveResponse>(
        `/api/v1/projects/${projectId}/templates/${templateId}`,
        {
          method: "PATCH",
          body: { is_active: isActive },
        },
      ).then(
        () => ({ ok: true as const }),
        (err: unknown) => ({ ok: false as const, error: err }),
      );

      if (!result.ok) {
        const err = result.error;
        toast.error(`${t("extraction", "errors_updateTemplateStatus")}: ${
          err instanceof Error ? err.message : "unknown error"
        }`);
        return false;
      }

      await refresh().catch(() => undefined);
      toast.success(
        t(
          "extraction",
          isActive ? "templateActivatedSuccess" : "templateDeactivatedSuccess",
        ),
      );
      return true;
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

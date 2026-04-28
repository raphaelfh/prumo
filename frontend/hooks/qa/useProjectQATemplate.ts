/**
 * Loads a project-level QA template (a clone of a global PROBAST/QUADAS-2)
 * along with its domains and fields. Used by QualityAssessmentFullScreen
 * once `useQAAssessmentSession` has resolved the project_template_id, so
 * the form renders against the entity_type/field ids that proposals will
 * reference (not the global template ids).
 */

import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type {
  ExtractionEntityType,
  ExtractionField,
} from "@/types/extraction";

import type { QADomain, QATemplate } from "./useQATemplate";

interface UseProjectQATemplateProps {
  projectTemplateId: string | undefined;
  enabled?: boolean;
}

interface UseProjectQATemplateResult {
  template: QATemplate | null;
  domains: QADomain[];
  loading: boolean;
  error: string | null;
}

export function useProjectQATemplate({
  projectTemplateId,
  enabled = true,
}: UseProjectQATemplateProps): UseProjectQATemplateResult {
  const [template, setTemplate] = useState<QATemplate | null>(null);
  const [domains, setDomains] = useState<QADomain[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !projectTemplateId) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const tplRes = await supabase
          .from("project_extraction_templates")
          .select("id, name, description, framework, version, kind")
          .eq("id", projectTemplateId)
          .maybeSingle();
        if (tplRes.error) throw tplRes.error;
        if (!tplRes.data) throw new Error("Project template not found");
        if (tplRes.data.kind !== "quality_assessment") {
          throw new Error(
            `Template kind '${tplRes.data.kind}' is not 'quality_assessment'`,
          );
        }

        const etRes = await supabase
          .from("extraction_entity_types")
          .select("*")
          .eq("project_template_id", projectTemplateId)
          .order("sort_order", { ascending: true });
        if (etRes.error) throw etRes.error;

        const entityIds = (etRes.data ?? []).map((e) => e.id);
        const fieldsRes = entityIds.length
          ? await supabase
              .from("extraction_fields")
              .select("*")
              .in("entity_type_id", entityIds)
              .order("sort_order", { ascending: true })
          : { data: [], error: null };
        if (fieldsRes.error) throw fieldsRes.error;

        const fieldsByEntity = new Map<string, ExtractionField[]>();
        for (const f of fieldsRes.data ?? []) {
          const list = fieldsByEntity.get(f.entity_type_id) ?? [];
          list.push(f as ExtractionField);
          fieldsByEntity.set(f.entity_type_id, list);
        }

        const grouped: QADomain[] = (etRes.data ?? []).map((et) => ({
          entityType: et as ExtractionEntityType,
          fields: fieldsByEntity.get(et.id) ?? [],
        }));

        if (!cancelled) {
          setTemplate(tplRes.data as QATemplate);
          setDomains(grouped);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load project QA template",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectTemplateId, enabled]);

  return { template, domains, loading, error };
}

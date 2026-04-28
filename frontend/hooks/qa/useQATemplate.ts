/**
 * Hook to load a quality-assessment template (PROBAST / QUADAS-2 / ...)
 * from the global template registry.
 *
 * Differs from `useHITLProjectTemplates` in that this one fetches a
 * single template's full entity_types + fields tree (so the form can
 * render its inputs), not just a flat list of templates available to
 * the project.
 */

import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type {
  ExtractionEntityType,
  ExtractionField,
} from "@/types/extraction";

export interface QATemplate {
  id: string;
  name: string;
  description?: string | null;
  framework: string;
  version: string;
  kind: string;
}

export interface QADomain {
  entityType: ExtractionEntityType;
  fields: ExtractionField[];
}

export interface UseQATemplateResult {
  template: QATemplate | null;
  domains: QADomain[];
  loading: boolean;
  error: string | null;
}

interface UseQATemplateProps {
  templateId: string | undefined;
  enabled?: boolean;
}

export function useQATemplate({
  templateId,
  enabled = true,
}: UseQATemplateProps): UseQATemplateResult {
  const [template, setTemplate] = useState<QATemplate | null>(null);
  const [domains, setDomains] = useState<QADomain[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !templateId) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Template
        const tplRes = await supabase
          .from("extraction_templates_global")
          .select("id, name, description, framework, version, kind")
          .eq("id", templateId)
          .maybeSingle();
        if (tplRes.error) throw tplRes.error;
        if (!tplRes.data) throw new Error("Template not found");
        if (tplRes.data.kind !== "quality_assessment") {
          throw new Error(
            `Template kind '${tplRes.data.kind}' is not 'quality_assessment'`,
          );
        }

        // 2) Entity types (domains)
        const etRes = await supabase
          .from("extraction_entity_types")
          .select("*")
          .eq("template_id", templateId)
          .order("sort_order", { ascending: true });
        if (etRes.error) throw etRes.error;

        // 3) Fields for each entity type
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
            err instanceof Error ? err.message : "Failed to load QA template",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, enabled]);

  return { template, domains, loading, error };
}

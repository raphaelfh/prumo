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

import { loadGlobalQATemplate } from "@/services/qaTemplateService";
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

  // Reset loading state when query coordinates change (during render, so
  // the fetch below never calls setState synchronously inside the effect).
  const [prevKey, setPrevKey] = useState({ templateId, enabled });
  if (templateId !== prevKey.templateId || enabled !== prevKey.enabled) {
    setPrevKey({ templateId, enabled });
    if (enabled && templateId) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    if (!enabled || !templateId) return;

    let cancelled = false;
    void loadGlobalQATemplate(templateId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTemplate(result.data.template);
        setDomains(result.data.domains);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [templateId, enabled]);

  return { template, domains, loading, error };
}

/**
 * Loads a project-level QA template (a clone of a global PROBAST/QUADAS-2)
 * along with its domains and fields. Used by QualityAssessmentFullScreen
 * once `useQAAssessmentSession` has resolved the project_template_id, so
 * the form renders against the entity_type/field ids that proposals will
 * reference (not the global template ids).
 */

import { useEffect, useState } from "react";

import { loadProjectQATemplate } from "@/services/qaTemplateService";
import type {
  ExtractionEntityType,
  ExtractionField,
} from "@/types/extraction";

import type { QADomain, QATemplate } from "./useQATemplate";

export type { QADomain, QATemplate };

// Re-export EntityTypeWithFields shape for consumers that need it.
export type EntityTypeWithFields = ExtractionEntityType & {
  extraction_fields?: ExtractionField[];
};

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

  // Reset loading state when query coordinates change (during render, so
  // the fetch below never calls setState synchronously inside the effect).
  const [prevKey, setPrevKey] = useState({ projectTemplateId, enabled });
  if (projectTemplateId !== prevKey.projectTemplateId || enabled !== prevKey.enabled) {
    setPrevKey({ projectTemplateId, enabled });
    if (enabled && projectTemplateId) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    if (!enabled || !projectTemplateId) return;

    let cancelled = false;
    void loadProjectQATemplate(projectTemplateId).then((result) => {
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
  }, [projectTemplateId, enabled]);

  return { template, domains, loading, error };
}

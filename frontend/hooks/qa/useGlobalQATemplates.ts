/**
 * Lists global QA templates (PROBAST, QUADAS-2, future) so the UI can
 * present a "Open Quality Assessment" picker without hard-coding ids.
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';

export interface GlobalQATemplate {
  id: string;
  name: string;
  description: string | null;
  framework: string;
  version: string;
}

interface UseGlobalQATemplatesReturn {
  templates: GlobalQATemplate[];
  loading: boolean;
  error: string | null;
}

export function useGlobalQATemplates(): UseGlobalQATemplatesReturn {
  const [templates, setTemplates] = useState<GlobalQATemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error: queryError } = await supabase
        .from('extraction_templates_global')
        .select('id, name, description, framework, version')
        .eq('kind', 'quality_assessment')
        .order('name', { ascending: true });
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message);
        setTemplates([]);
      } else {
        setTemplates((data ?? []) as GlobalQATemplate[]);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { templates, loading, error };
}

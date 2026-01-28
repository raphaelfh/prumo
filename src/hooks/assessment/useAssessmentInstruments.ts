import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AssessmentInstrument, AssessmentItem } from "@/types/assessment";
export type { AssessmentInstrument, AssessmentItem } from "@/types/assessment";
import { normalizeAssessmentItem, parseInstrumentSchema } from "@/lib/assessment-utils";

export const useAssessmentInstruments = () => {
  const [instruments, setInstruments] = useState<AssessmentInstrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInstruments();
  }, []);

  const loadInstruments = async () => {
    try {
      setError(null);
      const { data, error } = await supabase
        .from("assessment_instruments")
        .select("id, name, tool_type, version, mode, is_active, aggregation_rules, schema, created_at")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      const normalized = (data || []).map((instrument) => ({
        ...instrument,
        schema: parseInstrumentSchema(instrument.schema),
      })) as AssessmentInstrument[];
      setInstruments(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao carregar instrumentos";
      console.error("Error loading instruments:", error);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return { instruments, loading, error };
};

export const useAssessmentItems = (instrumentId: string | null) => {
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (instrumentId) {
      loadItems();
    }
  }, [instrumentId]);

  const loadItems = async () => {
    if (!instrumentId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("assessment_items")
        .select("id, instrument_id, item_code, domain, question, sort_order, required, allowed_levels, created_at")
        .eq("instrument_id", instrumentId)
        .order("sort_order");

      if (error) throw error;
      setItems((data || []).map(normalizeAssessmentItem));
    } catch (error) {
      console.error("Error loading items:", error);
    } finally {
      setLoading(false);
    }
  };

  return { items, loading };
};

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";

export type AssessmentInstrument = Tables<"assessment_instruments">;
export type AssessmentItem = Tables<"assessment_items">;

export const useAssessmentInstruments = () => {
  const [instruments, setInstruments] = useState<AssessmentInstrument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInstruments();
  }, []);

  const loadInstruments = async () => {
    try {
      const { data, error } = await supabase
        .from("assessment_instruments")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      setInstruments((data || []) as AssessmentInstrument[]);
    } catch (error) {
      console.error("Error loading instruments:", error);
    } finally {
      setLoading(false);
    }
  };

  return { instruments, loading };
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
        .select("*")
        .eq("instrument_id", instrumentId)
        .order("sort_order");

      if (error) throw error;
      setItems((data || []) as AssessmentItem[]);
    } catch (error) {
      console.error("Error loading items:", error);
    } finally {
      setLoading(false);
    }
  };

  return { items, loading };
};

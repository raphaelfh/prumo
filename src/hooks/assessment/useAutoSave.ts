import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UseAutoSaveProps {
  projectId: string;
  articleId: string;
  instrumentId: string;
  toolType: string;
  responses: Record<string, { level: string; comment?: string }>;
  assessmentId: string | null;
  onAssessmentIdChange: (id: string) => void;
  debounceMs?: number;
  enabled?: boolean;
  extractionInstanceId?: string | null; // Novo: para assessment por instância
}

export const useAutoSave = ({
  projectId,
  articleId,
  instrumentId,
  toolType,
  responses,
  assessmentId,
  onAssessmentIdChange,
  debounceMs = 2000,
  enabled = true,
  extractionInstanceId = null,
}: UseAutoSaveProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const responsesRef = useRef(responses);

  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);

  const save = useCallback(async () => {
    // Validate required fields before attempting to save
    if (!projectId || !articleId || !instrumentId || !toolType) {
      console.warn("Auto-save skipped: missing required fields", {
        projectId: !!projectId,
        articleId: !!articleId,
        instrumentId: !!instrumentId,
        toolType: !!toolType,
      });
      return;
    }

    if (Object.keys(responsesRef.current).length === 0) return;

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error("Auto-save failed: user not authenticated");
        throw new Error("Usuário não autenticado");
      }

      const totalItems = Object.keys(responsesRef.current).length;
      const completedItems = Object.values(responsesRef.current).filter((r) => r.level).length;
      const completionPercentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

      const assessmentData = {
        project_id: projectId,
        article_id: articleId,
        user_id: user.id,
        instrument_id: instrumentId,
        tool_type: toolType,
        responses: responsesRef.current,
        status: "in_progress" as const,
        completion_percentage: completionPercentage,
        extraction_instance_id: extractionInstanceId, // Incluir se fornecido
      };

      if (assessmentId) {
        const { error } = await supabase
          .from("assessments")
          .update(assessmentData)
          .eq("id", assessmentId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("assessments")
          .insert([assessmentData])
          .select()
          .single();

        if (error) throw error;
        onAssessmentIdChange(data.id);
      }

      setLastSaved(new Date());
    } catch (error: any) {
      console.error("Error auto-saving:", error);
      
      // Provide more specific error messages
      if (error.message?.includes("row-level security")) {
        toast.error("Erro de permissão ao salvar. Verifique se você tem acesso ao projeto.");
      } else if (error.message?.includes("not authenticated")) {
        toast.error("Sessão expirada. Faça login novamente.");
      } else {
        toast.error(`Erro ao salvar: ${error.message || "Erro desconhecido"}`);
      }
    } finally {
      setIsSaving(false);
    }
  }, [projectId, articleId, instrumentId, toolType, assessmentId, onAssessmentIdChange, extractionInstanceId]);

  useEffect(() => {
    // Only auto-save if enabled and all required data is present
    if (!enabled) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      save();
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [responses, save, debounceMs, enabled]);

  return { isSaving, lastSaved, forceSave: save };
};

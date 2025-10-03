import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAssessmentItems, AssessmentInstrument } from "@/hooks/assessment/useAssessmentInstruments";
import { DomainAccordion } from "./DomainAccordion";
import { AssessmentProgress } from "./AssessmentProgress";
import { BatchAssessmentBar } from "./BatchAssessmentBar";
import { Loader2, Save, CheckCircle } from "lucide-react";
import { TablesInsert } from "@/integrations/supabase/types";

interface AssessmentFormProps {
  projectId: string;
  articleId: string;
  instrument: AssessmentInstrument;
  existingAssessment?: any;
  onSaved?: () => void;
}

export const AssessmentForm = ({
  projectId,
  articleId,
  instrument,
  existingAssessment,
  onSaved,
}: AssessmentFormProps) => {
  const { items, loading: itemsLoading } = useAssessmentItems(instrument.id);
  const [responses, setResponses] = useState<Record<string, { level: string; comment?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string | null>(existingAssessment?.id || null);

  useEffect(() => {
    if (existingAssessment?.responses) {
      setResponses(existingAssessment.responses);
      setAssessmentId(existingAssessment.id);
    }
  }, [existingAssessment]);

  const handleResponseChange = (itemCode: string, level: string) => {
    setResponses((prev) => ({
      ...prev,
      [itemCode]: { ...prev[itemCode], level },
    }));
  };

  const handleCommentChange = (itemCode: string, comment: string) => {
    setResponses((prev) => ({
      ...prev,
      [itemCode]: { ...prev[itemCode], comment },
    }));
  };

  const calculateCompletion = () => {
    const totalItems = items.length;
    const completedItems = Object.values(responses).filter((r) => r.level).length;
    return totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  };

  const isComplete = () => {
    return items.every((item) => responses[item.item_code]?.level);
  };

  const handleSave = async (markAsCompleted = false) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const completionPercentage = calculateCompletion();
      const status = markAsCompleted && isComplete() ? ("submitted" as const) : ("in_progress" as const);

      const assessmentData: TablesInsert<"assessments"> = {
        project_id: projectId,
        article_id: articleId,
        user_id: user.id,
        instrument_id: instrument.id,
        tool_type: instrument.tool_type,
        responses: responses as any,
        status,
        completion_percentage: completionPercentage,
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
        setAssessmentId(data.id);
      }

      toast.success(markAsCompleted ? "Avaliação concluída!" : "Progresso salvo");
      onSaved?.();
    } catch (error: any) {
      console.error("Error saving assessment:", error);
      toast.error("Erro ao salvar avaliação");
    } finally {
      setSaving(false);
    }
  };

  if (itemsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const schema = typeof instrument.schema === 'string' 
    ? JSON.parse(instrument.schema) 
    : instrument.schema;
  const domains = schema?.domains || [];
  
  // Default fallback levels if items don't have them defined
  const defaultAllowedLevels = ["low", "high", "unclear"];
    
  const completion = calculateCompletion();
  const canComplete = isComplete();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{instrument.name}</CardTitle>
          <CardDescription>Versão {instrument.version}</CardDescription>
        </CardHeader>
        <CardContent>
          <AssessmentProgress
            completionPercentage={completion}
            status={existingAssessment?.status || "in_progress"}
          />
        </CardContent>
      </Card>

      {/* Barra de Avaliação em Lote */}
      <BatchAssessmentBar
        projectId={projectId}
        articleId={articleId}
        instrumentId={instrument.id}
        items={items}
        responses={responses}
        onResponseChange={handleResponseChange}
        onCommentChange={handleCommentChange}
      />

      <div className="space-y-4">
        {domains.map((domain: any) => (
          <DomainAccordion
            key={domain.code}
            domain={domain.code}
            domainName={domain.name}
            items={items}
            responses={responses}
            instrumentAllowedLevels={defaultAllowedLevels}
            onResponseChange={handleResponseChange}
            onCommentChange={handleCommentChange}
            projectId={projectId}
            articleId={articleId}
            instrumentId={instrument.id}
          />
        ))}
      </div>

      <div className="flex gap-3 justify-end sticky bottom-4 bg-background/95 backdrop-blur py-4 border-t">
        <Button
          variant="outline"
          onClick={() => handleSave(false)}
          disabled={saving || Object.keys(responses).length === 0}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar Progresso
        </Button>
        <Button
          onClick={() => handleSave(true)}
          disabled={saving || !canComplete}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="mr-2 h-4 w-4" />
          )}
          Concluir Avaliação
        </Button>
      </div>
    </div>
  );
};

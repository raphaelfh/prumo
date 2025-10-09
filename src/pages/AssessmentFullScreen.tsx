import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAssessmentItems, AssessmentInstrument } from "@/hooks/assessment/useAssessmentInstruments";
import { DomainAccordion } from "@/components/assessment/DomainAccordion";
import { AssessmentToolbar } from "@/components/assessment/AssessmentToolbar";
import { BatchAssessmentBar } from "@/components/assessment/BatchAssessmentBar";
import { useAutoSave } from "@/hooks/assessment/useAutoSave";
import { useUndoRedo } from "@/hooks/assessment/useUndoRedo";
import { useBlindReview } from "@/hooks/assessment/useBlindReview";
import { useOtherAssessments } from "@/hooks/assessment/useOtherAssessments";
import { OtherAssessmentsCard } from "@/components/assessment/OtherAssessmentsCard";
import { AssessmentComparisonCard } from "@/components/assessment/AssessmentComparisonCard";
import { AssessmentComparisonView } from "@/components/assessment/AssessmentComparisonView";
import { PDFViewer } from "@/components/PDFViewer";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ArrowLeft, CheckCircle, Loader2, FileText, Users, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Progress } from "@/components/ui/progress";

export default function AssessmentFullScreen() {
  const { projectId, articleId, instrumentId } = useParams();
  const navigate = useNavigate();
  
  const [instrument, setInstrument] = useState<AssessmentInstrument | null>(null);
  const [article, setArticle] = useState<any>(null);
  const [existingAssessment, setExistingAssessment] = useState<any>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPDF, setShowPDF] = useState(true);
  const [showComparison, setShowComparison] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const { items, loading: itemsLoading } = useAssessmentItems(instrument?.id || "");

  // Blind mode e outros assessments
  const { isBlindMode, isLoading: blindLoading } = useBlindReview(projectId || "", currentUserId || "");
  const { 
    otherAssessments, 
    getOtherAssessmentsForArticle 
  } = useOtherAssessments(
    projectId || "", 
    currentUserId || "", 
    !isBlindMode && !blindLoading
  );

  const {
    state: responses,
    setState: setResponses,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<Record<string, { level: string; comment?: string }>>({
    initialState: {},
    maxHistorySize: 50,
  });

  // Only initialize auto-save when all required data is available
  const { isSaving, lastSaved } = useAutoSave({
    projectId: projectId || "",
    articleId: articleId || "",
    instrumentId: instrument?.id || "",
    toolType: instrument?.tool_type || "",
    responses,
    assessmentId,
    onAssessmentIdChange: setAssessmentId,
    enabled: !!(projectId && articleId && instrument?.id && instrument?.tool_type),
  });

  useEffect(() => {
    const loadData = async () => {
      if (!projectId || !articleId || !instrumentId) return;

      try {
        // Load article
        const { data: articleData, error: articleError } = await supabase
          .from("articles")
          .select("*")
          .eq("id", articleId)
          .single();

        if (articleError) throw articleError;
        setArticle(articleData);

        // Load instrument directly from URL parameter
        const { data: instrumentData, error: instrumentError } = await supabase
          .from("assessment_instruments")
          .select("*")
          .eq("id", instrumentId)
          .single();

        if (instrumentError) throw instrumentError;
        
        if (!instrumentData) {
          toast.error("Instrumento de avaliação não encontrado");
          setLoading(false);
          return;
        }
        
        setInstrument(instrumentData);

        // Load existing assessment
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          
          const { data: assessmentData } = await supabase
            .from("assessments")
            .select("*")
            .eq("article_id", articleId)
            .eq("instrument_id", instrumentId)
            .eq("user_id", user.id)
            .eq("is_current_version", true)
            .maybeSingle();

          if (assessmentData) {
            setExistingAssessment(assessmentData);
            setAssessmentId(assessmentData.id);
            setResponses(assessmentData.responses as Record<string, { level: string; comment?: string }> || {});
          }
        }
      } catch (error: any) {
        console.error("Error loading data:", error);
        toast.error("Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [projectId, articleId, instrumentId]);

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

  const handleSubmit = async () => {
    if (!isComplete()) {
      toast.error("Complete todas as perguntas antes de finalizar");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("assessments")
        .update({ status: "submitted" })
        .eq("id", assessmentId);

      if (error) throw error;

      toast.success("Avaliação concluída com sucesso!");
      navigate(`/projects/${projectId}`);
    } catch (error: any) {
      console.error("Error submitting assessment:", error);
      toast.error("Erro ao finalizar avaliação");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || itemsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!instrument) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Nenhum instrumento configurado</p>
        <Button onClick={() => navigate(`/projects/${projectId}`)}>
          Voltar ao Projeto
        </Button>
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

  // Obter assessments de outros usuários para o artigo atual
  const otherAssessmentsForArticle = getOtherAssessmentsForArticle(articleId || "", instrumentId || "");
  const hasOtherAssessments = !isBlindMode && !blindLoading && otherAssessmentsForArticle.length > 0;
  const showOtherAssessments = hasOtherAssessments && showComparison;


  return (
    <div className="h-screen flex flex-col">
      <AssessmentToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        isSaving={isSaving}
        lastSaved={lastSaved}
        completionPercentage={completion}
      />

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Comparison Panel - lado esquerdo */}
        <ResizablePanel 
          defaultSize={showOtherAssessments ? 30 : 0} 
          minSize={showOtherAssessments ? 25 : 0} 
          maxSize={showOtherAssessments ? 40 : 0}
          className={showOtherAssessments ? "" : "hidden"}
        >
          <div className="h-full p-4">
            <AssessmentComparisonView
              items={items}
              currentResponses={responses}
              otherAssessments={otherAssessmentsForArticle}
              instrumentAllowedLevels={defaultAllowedLevels}
              schema={schema}
              className="h-full"
            />
          </div>
        </ResizablePanel>
        
        {/* Resizable Handle entre Comparison e Assessment */}
        <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary/20 transition-colors" />

        {/* Assessment Form Panel */}
        <ResizablePanel 
          defaultSize={showOtherAssessments ? (showPDF ? 40 : 70) : (showPDF ? 60 : 100)} 
          minSize={30}
        >
          <div className="h-full overflow-y-auto">
            <div className="container max-w-5xl py-6 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/projects/${projectId}`)}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Button>
                  
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem>
                        <BreadcrumbLink onClick={() => navigate("/")}>
                          Projetos
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbLink onClick={() => navigate(`/projects/${projectId}`)}>
                          Projeto
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Avaliação</BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>

                <div className="flex items-center gap-2">
                  {/* Botão de Comparação - apenas quando há outros assessments */}
                  {hasOtherAssessments && (
                    <Button
                      variant={showComparison ? "default" : "outline"}
                      size="sm"
                      onClick={() => setShowComparison(!showComparison)}
                      className="flex items-center gap-2"
                    >
                      <Users className="h-4 w-4" />
                      {showComparison ? "Ocultar Comparação" : "Comparar com Outros"}
                    </Button>
                  )}
                  
                  <Button
                    variant={showPDF ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowPDF(!showPDF)}
                    className="flex items-center gap-2"
                    title={showPDF ? "Ocultar PDF" : "Mostrar PDF"}
                  >
                    <FileText className="h-4 w-4" />
                    {showPDF ? "Ocultar PDF" : "Mostrar PDF"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold">{instrument.name}</h1>
                <p className="text-sm text-muted-foreground">
                  Artigo: {article?.title}
                </p>
                <Progress value={completion} className="h-2" />
              </div>

              {/* Barra de Avaliação em Lote */}
              <BatchAssessmentBar
                projectId={projectId || ""}
                articleId={articleId || ""}
                instrumentId={instrumentId || ""}
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
                    instrumentId={instrumentId}
                  />
                ))}
              </div>

              <div className="flex justify-end pb-6">
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  disabled={submitting || !canComplete || isSaving}
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  Concluir Avaliação
                </Button>
              </div>
            </div>
          </div>
        </ResizablePanel>

        {/* Resizable Handle entre Assessment e PDF */}
        <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary/20 transition-colors" />

        {/* PDF Viewer Panel */}
        <ResizablePanel 
          defaultSize={showPDF ? (showOtherAssessments ? 30 : 40) : 0} 
          minSize={showPDF ? 30 : 0}
          className={showPDF ? "" : "hidden"}
        >
          <PDFViewer articleId={articleId || ""} projectId={projectId || ""} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

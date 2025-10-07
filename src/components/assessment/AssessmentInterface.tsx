import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Bot, BarChart3, Clock, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAssessmentInstruments, useAssessmentItems } from "@/hooks/assessment/useAssessmentInstruments";
import { useBlindReview } from "@/hooks/assessment/useBlindReview";
import { useUndoRedo } from "@/hooks/assessment/useUndoRedo";
import { InstrumentSelector } from "./InstrumentSelector";
import { AIAssessmentConfigModal } from "./AIAssessmentConfigModal";
import { BlindModeToggle } from "./BlindModeToggle";
import { DiscordanceIndicator } from "./DiscordanceIndicator";
import { AssessmentHeader } from "./AssessmentHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BatchAssessmentService, BatchAssessmentProgress } from "@/services/batchAssessmentService";

interface AssessmentInterfaceProps {
  projectId: string;
}

export const AssessmentInterface = ({ projectId }: AssessmentInterfaceProps) => {
  const navigate = useNavigate();
  const { articleId } = useParams();
  const { instruments } = useAssessmentInstruments();
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const { items: assessmentItems } = useAssessmentItems(selectedInstrument);
  const [articles, setArticles] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [aiConfigModalOpen, setAiConfigModalOpen] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchAssessmentProgress | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const batchServiceRef = useRef<BatchAssessmentService | null>(null);

  // Hook para undo/redo das configurações da interface
  const {
    setState: setInterfaceState,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo({
    initialState: {
      selectedInstrument: null as string | null,
      selectedArticles: [] as string[],
      selectedItems: [] as string[],
    },
    maxHistorySize: 50,
  });
  
  // Hook para blind review
  const [userId, setUserId] = useState<string | null>(null);
  const {
    isBlindMode,
    canManageBlindMode,
    discordanceData,
    getDiscordanceForArticle,
    refreshDiscordanceData
  } = useBlindReview(projectId, userId || '');

  useEffect(() => {
    loadArticles();
    loadAssessments();
    loadUserId();
  }, [projectId]);

  const loadUserId = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    } catch (error) {
      console.error('Error loading user ID:', error);
    }
  };

  // Auto-seleciona o primeiro instrumento quando disponível
  useEffect(() => {
    if (!selectedInstrument && instruments.length > 0) {
      setSelectedInstrument(instruments[0].id);
    }
  }, [instruments, selectedInstrument]);

  // Atualiza o estado de undo/redo quando o instrumento muda
  useEffect(() => {
    if (selectedInstrument) {
      setInterfaceState((prev) => ({
        ...prev,
        selectedInstrument,
      }));
      setLastSaved(new Date());
    }
  }, [selectedInstrument, setInterfaceState]);

  // Encontra o índice do artigo atual
  const currentArticleIndex = articleId 
    ? articles.findIndex(article => article.id === articleId)
    : undefined;

  // Recarrega dados de discordância quando o blind mode mudar (mas não assessments)
  useEffect(() => {
    if (userId && !isBlindMode) {
      refreshDiscordanceData();
    }
  }, [isBlindMode, userId, refreshDiscordanceData]);

  const loadArticles = async () => {
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error("Error loading articles:", error);
      toast.error("Erro ao carregar artigos");
    }
  };

  const loadAssessments = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // SEMPRE carrega apenas as avaliações do usuário logado
      // Cada usuário deve ver e editar apenas suas próprias avaliações
      const { data, error } = await supabase
        .from("assessments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id);

      if (error) throw error;
      setAssessments(data || []);
    } catch (error: any) {
      console.error("Error loading assessments:", error);
    }
  };

  const getArticleAssessment = (articleId: string) => {
    // Sempre retorna a avaliação do usuário logado para o artigo/instrumento
    return assessments.find((a) => a.article_id === articleId && a.instrument_id === selectedInstrument);
  };

  const handleStartAssessment = (article: any) => {
    if (!selectedInstrument) {
      toast.error("Selecione um instrumento primeiro");
      return;
    }
    navigate(`/projects/${projectId}/assessment/${article.id}/${selectedInstrument}`);
  };

  const getStatusBadge = (assessment: any) => {
    if (!assessment) {
      return <Badge variant="outline">Não iniciado</Badge>;
    }
    
    const statusColors: Record<string, string> = {
      in_progress: "bg-warning",
      submitted: "bg-success",
      reviewed: "bg-info",
      locked: "bg-muted",
      archived: "bg-muted",
    };

    const statusLabels: Record<string, string> = {
      in_progress: "Em progresso",
      submitted: "Completo",
      reviewed: "Revisado",
      locked: "Bloqueado",
      archived: "Arquivado",
    };

    return (
      <Badge className={statusColors[assessment.status] || "bg-muted"}>
        {statusLabels[assessment.status] || assessment.status}
      </Badge>
    );
  };

  const handleCancelBatchProcessing = () => {
    if (batchServiceRef.current) {
      batchServiceRef.current.cancel();
      toast.info("Cancelando processamento...");
    }
  };

  const handleStartBatchProcessing = async (batchConfig: {
    config: any;
    selectedArticles: string[];
    selectedItems: string[];
  }) => {
    setBatchProcessing(true);
    setBatchProgress(null);

    try {
      // Valida seleções
      if (batchConfig.selectedArticles.length === 0 || batchConfig.selectedItems.length === 0) {
        toast.error("Selecione pelo menos um artigo e uma questão");
        return;
      }

      // Prepara dados dos artigos selecionados
      const selectedArticlesData = articles.filter(a => 
        batchConfig.selectedArticles.includes(a.id)
      );

      // Prepara dados dos itens selecionados
      const selectedItemsData = assessmentItems.filter(item => 
        batchConfig.selectedItems.includes(item.id)
      );

      // Cria instância do serviço com callback de progresso
      batchServiceRef.current = new BatchAssessmentService((progress) => {
        setBatchProgress(progress);
      });

      toast.info(
        `Iniciando avaliação de ${selectedArticlesData.length} artigos × ${selectedItemsData.length} questões`
      );

      // Executa processamento em batch
      const results = await batchServiceRef.current.processBatchAssessment(
        projectId,
        selectedInstrument!,
        selectedArticlesData,
        selectedItemsData,
        batchConfig.config
      );

      // Recarrega assessments após processamento
      await loadAssessments();

      // Feedback de conclusão
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        toast.success(`✅ Processamento concluído! ${successful} avaliações realizadas com sucesso`);
      } else {
        toast.warning(
          `⚠️ Processamento concluído com erros. ${successful} sucessos, ${failed} falhas`,
          {
            description: "Verifique o console para detalhes dos erros"
          }
        );
      }

    } catch (error: any) {
      console.error('Error in batch processing:', error);
      toast.error("Erro durante o processamento em lote", {
        description: error.message || "Erro desconhecido"
      });
    } finally {
      setBatchProcessing(false);
      setBatchProgress(null);
      batchServiceRef.current = null;
    }
  };

  // Calcula progresso considerando assessments por artigo (não por item individual)
  const assessmentsForInstrument = assessments.filter(a => a.instrument_id === selectedInstrument);
  const completedAssessments = assessmentsForInstrument.filter(
    a => a.status === 'submitted' || a.completion_percentage === 100
  ).length;
  const inProgressAssessments = assessmentsForInstrument.filter(
    a => a.status === 'in_progress' && a.completion_percentage > 0 && a.completion_percentage < 100
  ).length;
  
  // Total de assessments é o número de artigos (um assessment por artigo)
  const totalAssessments = articles.length;
  const progressPercentage = totalAssessments > 0 
    ? Math.round((completedAssessments / totalAssessments) * 100)
    : 0;

  return (
    <div className="space-y-0">
      {/* Header da Avaliação */}
      <AssessmentHeader
        projectId={projectId}
        articles={articles}
        currentArticleIndex={currentArticleIndex}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        lastSaved={lastSaved}
        progressPercentage={progressPercentage}
      />

      {/* Conteúdo principal */}
      <div className="space-y-6 p-6">
      {/* Indicador de Processamento em Batch */}
      {batchProcessing && batchProgress && (
        <Card className="border-blue-500 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  <div>
                    <h3 className="font-semibold text-blue-900">
                      Processamento em Lote Ativo
                    </h3>
                    <p className="text-sm text-blue-700">
                      {batchProgress.currentTask ? (
                        <>
                          Avaliando: <span className="font-medium">{batchProgress.currentTask.itemCode}</span> em{" "}
                          <span className="font-medium">{batchProgress.currentTask.articleTitle}</span>
                        </>
                      ) : (
                        "Inicializando..."
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelBatchProcessing}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancelar
                </Button>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-blue-700">
                    Progresso: {batchProgress.completed}/{batchProgress.total}
                  </span>
                  <span className="text-blue-700">
                    ✓ {batchProgress.successful} | ✗ {batchProgress.failed}
                  </span>
                </div>
                <Progress 
                  value={(batchProgress.completed / batchProgress.total) * 100}
                  className="h-3"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Barra de Features */}
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Estatísticas Gerais */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium">{articles.length}</p>
                <p className="text-xs text-muted-foreground">Artigos</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="p-2 bg-green-100 rounded-lg">
                <BarChart3 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {completedAssessments}
                  {inProgressAssessments > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      (+{inProgressAssessments})
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">Completas</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Clock className="h-4 w-4 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {assessmentItems.length}
                </p>
                <p className="text-xs text-muted-foreground">Questões</p>
              </div>
            </div>

            {/* Botão de IA */}
            <div className="flex items-center justify-end">
              <Button
                onClick={() => setAiConfigModalOpen(true)}
                disabled={!selectedInstrument || articles.length === 0 || batchProcessing}
                className="flex items-center gap-2"
              >
                <Bot className="h-4 w-4" />
                {batchProcessing ? "Processando..." : "Avaliação com IA"}
              </Button>
            </div>
          </div>

          {/* Indicador de Progresso */}
          {selectedInstrument && totalAssessments > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Progresso Geral</span>
                <span className="text-sm text-muted-foreground">
                  {completedAssessments}/{totalAssessments} artigos ({progressPercentage}%)
                </span>
              </div>
              <Progress 
                value={progressPercentage} 
                className="h-2"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Configuração da Avaliação</CardTitle>
              <CardDescription>Selecione o instrumento de avaliação</CardDescription>
            </div>
            {userId && (
              <BlindModeToggle 
                projectId={projectId} 
                userId={userId}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <InstrumentSelector
            instruments={instruments}
            value={selectedInstrument}
            onValueChange={setSelectedInstrument}
          />
        </CardContent>
      </Card>

      {selectedInstrument && (
        <Card>
          <CardHeader>
            <CardTitle>Artigos para Avaliação</CardTitle>
            <CardDescription>
              {isBlindMode ? (
                <>
                  Modo blind ativo - você só pode ver suas próprias avaliações
                  {!canManageBlindMode && " (apenas managers podem alterar esta configuração)"}
                </>
              ) : (
                <>
                  Clique em "Avaliar" para iniciar ou continuar a avaliação de um artigo. 
                  Você pode ver avaliações de outros revisores para comparação.
                  {discordanceData.length > 0 && (
                    <span className="ml-2 text-orange-600">
                      • {discordanceData.length} artigo(s) com discordâncias detectadas
                    </span>
                  )}
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {articles.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Nenhum artigo disponível para avaliação</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progresso</TableHead>
                    {!isBlindMode && (
                      <TableHead>Consenso</TableHead>
                    )}
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.map((article) => {
                    const assessment = getArticleAssessment(article.id);
                    const discordanceData = selectedInstrument 
                      ? getDiscordanceForArticle(article.id, selectedInstrument)
                      : null;
                    
                    return (
                      <TableRow key={article.id}>
                        <TableCell className="font-medium max-w-md truncate">
                          {article.title}
                        </TableCell>
                        <TableCell>{getStatusBadge(assessment)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <Progress value={assessment?.completion_percentage || 0} className="h-2" />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {assessment?.completion_percentage || 0}%
                            </span>
                          </div>
                        </TableCell>
                        {!isBlindMode && (
                          <TableCell>
                            <DiscordanceIndicator 
                              discordanceData={discordanceData}
                            />
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={assessment ? "outline" : "default"}
                            onClick={() => handleStartAssessment(article)}
                          >
                            {assessment ? "Continuar" : "Iniciar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

        {/* Modal de Configuração de IA */}
        <AIAssessmentConfigModal
          open={aiConfigModalOpen}
          onOpenChange={setAiConfigModalOpen}
          projectId={projectId}
          instrumentId={selectedInstrument || ''}
          articles={articles}
          assessmentItems={assessmentItems}
          onStartBatchProcessing={handleStartBatchProcessing}
        />
      </div>
    </div>
  );
};

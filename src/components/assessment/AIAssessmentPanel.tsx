import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Sparkles, 
  Loader2, 
  History, 
  Settings, 
  Play,
  Eye,
  ArrowRight
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AIAssessmentPreview } from './AIAssessmentPreview';
import { AIAssessmentHistory } from './AIAssessmentHistory';
import { AIConfigurationPanel } from './AIConfigurationPanel';
import { aiAssessmentClient } from '@/integrations/api/client';

interface AIConfiguration {
  model: string;
  temperature: number;
  maxTokens: number;
  forceFileSearch: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
}

interface AIAssessmentPanelProps {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;
  itemQuestion: string;
  onAccept: (level: string, comment: string) => void;
}

interface EvidencePassage {
  text: string;
  start_char?: number;
  end_char?: number;
  page_number?: number;
  relevance_score?: number;
}

interface AiAssessment {
  id: string;
  project_id: string;
  article_id: string;
  assessment_item_id: string;
  instrument_id: string;
  user_id: string;
  selected_level: string;
  confidence_score: number;
  justification: string;
  evidence_passages: EvidencePassage[];
  ai_model_used: string;
  processing_time_ms?: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  status: 'pending_review' | 'accepted' | 'rejected';
  created_at?: string;
  reviewed_at?: string | null;
  human_response?: string | null;
}

export const AIAssessmentPanel = ({
  projectId,
  articleId,
  assessmentItemId,
  instrumentId,
  itemQuestion,
  onAccept
}: AIAssessmentPanelProps) => {
  const [activeTab, setActiveTab] = useState('new');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentAssessment, setCurrentAssessment] = useState<AiAssessment | null>(null);
  const [selectedHistoryAssessment, setSelectedHistoryAssessment] = useState<AiAssessment | null>(null);
  const [configuration, setConfiguration] = useState<AIConfiguration | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const [assessmentsCount, setAssessmentsCount] = useState(0);
  const [assessments, setAssessments] = useState<AiAssessment[]>([]);
  const { toast } = useToast();

  // Verifica se há histórico de avaliações
  useEffect(() => {
    checkHistory();
  }, [projectId, articleId, assessmentItemId, instrumentId]);

  const checkHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_assessments')
        .select('id')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('assessment_item_id', assessmentItemId)
        .eq('instrument_id', instrumentId)
        .limit(1);

      if (error) throw error;
      const hasHistoryData = (data?.length || 0) > 0;
      setHasHistory(hasHistoryData);
      console.log('[AI Assessment Panel] Histórico verificado:', { hasHistoryData, count: data?.length || 0 });
    } catch (error) {
      console.error('Error checking history:', error);
    }
  };

  const getPdfStorageKey = async (): Promise<string> => {
    const { data, error } = await supabase
      .from('article_files')
      .select('id, file_type, storage_key, original_filename, created_at')
      .eq('article_id', articleId)
      .ilike('file_type', '%pdf%')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Erro ao buscar arquivos do artigo: ${error.message}`);
    }
    const file = data?.[0];
    const pdfStorageKey = file?.storage_key;

    if (!pdfStorageKey) {
      throw new Error('Nenhum PDF encontrado para este artigo. Faça upload do PDF primeiro.');
    }
    return pdfStorageKey;
  };

  const handleRunAIAssessment = async () => {
    setIsProcessing(true);
    const t0 = performance.now();

    try {
      const pdfStorageKey = await getPdfStorageKey();

      // Prepara o payload com as configurações (camelCase para FastAPI)
      const payload: Record<string, unknown> = {
        projectId,
        articleId,
        assessmentItemId,
        instrumentId,
        pdfStorageKey: pdfStorageKey,
      };

      // Adiciona configurações personalizadas se disponíveis
      if (configuration) {
        if (configuration.forceFileSearch) {
          payload.forceFileSearch = true;
        }
      }

      // Usa o cliente FastAPI ao invés de Edge Function
      // O apiClient retorna data diretamente se a request for bem-sucedida
      // e lança ApiError se falhar
      const data = await aiAssessmentClient<{
        id: string;
        selectedLevel: string;
        confidenceScore: number;
        justification: string;
        evidencePassages: EvidencePassage[];
        status: string;
        metadata?: {
          processingTimeMs?: number;
        };
      }>(payload);

      if (!data) {
        throw new Error('Resposta da API sem assessment.');
      }

      // Mapeia para o formato esperado pelo componente (snake_case)
      const assessment: AiAssessment = {
        id: data.id,
        project_id: projectId,
        article_id: articleId,
        assessment_item_id: assessmentItemId,
        instrument_id: instrumentId,
        user_id: '', // Será preenchido pelo banco
        selected_level: data.selectedLevel,
        confidence_score: data.confidenceScore,
        justification: data.justification,
        evidence_passages: data.evidencePassages,
        ai_model_used: 'gpt-4o-mini',
        processing_time_ms: data.metadata?.processingTimeMs,
        status: data.status as 'pending_review' | 'accepted' | 'rejected',
      };

      setCurrentAssessment(assessment);
      setActiveTab('new'); // Mostra a nova avaliação
      
      // Atualiza o histórico
      checkHistory();
      
      // Força atualização do histórico após um pequeno delay para garantir que o banco foi atualizado
      setTimeout(() => {
        checkHistory();
      }, 1000);

      const took =
        data.metadata?.processingTimeMs != null
          ? (data.metadata.processingTimeMs / 1000).toFixed(1)
          : ((performance.now() - t0) / 1000).toFixed(1);

      toast({
        title: 'Avaliação IA concluída',
        description: `Processado em ${took}s`,
      });
    } catch (err: any) {
      console.error('[AI Assessment] Erro:', err);
      toast({
        title: 'Erro na avaliação',
        description: err?.message ?? 'Erro ao processar com IA',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptAssessment = async (assessment: AiAssessment) => {
    const evidenceBlock =
      assessment.evidence_passages?.map((e) => {
        const page = e.page_number != null ? ` (p.${e.page_number})` : '';
        return `• ${e.text}${page}`;
      }).join('\n') ?? '';

    const comment = `${assessment.justification}\n\n--- Evidências ---\n${evidenceBlock}`;

    onAccept(assessment.selected_level, comment);

    // Atualiza status no banco
    const { error } = await supabase
      .from('ai_assessments')
      .update({
        status: 'accepted',
        reviewed_at: new Date().toISOString(),
        human_response: assessment.selected_level,
      })
      .eq('id', assessment.id);

    if (error) {
      console.error('[AI Assessment] Falha ao atualizar status accepted', error);
      toast({
        title: 'Aviso',
        description: 'Resposta aplicada, mas não foi possível atualizar o status no banco.',
      });
    } else {
      toast({ 
        title: 'Resposta aceita', 
        description: 'A avaliação da IA foi aplicada ao assessment.' 
      });
    }

    // Limpa a avaliação atual
    setCurrentAssessment(null);
    setSelectedHistoryAssessment(null);
  };

  const handleRejectAssessment = async (assessment: AiAssessment) => {
    const { error } = await supabase
      .from('ai_assessments')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', assessment.id);

    if (error) {
      console.error('[AI Assessment] Falha ao atualizar status rejected', error);
      toast({
        title: 'Aviso',
        description: 'Não foi possível atualizar o status no banco.',
        variant: 'destructive',
      });
    } else {
      toast({ 
        title: 'Resposta rejeitada', 
        description: 'A avaliação da IA foi descartada.' 
      });
    }

    // Limpa a avaliação atual
    setCurrentAssessment(null);
    setSelectedHistoryAssessment(null);
  };

  const handleSelectHistoryAssessment = (assessment: AiAssessment) => {
    setSelectedHistoryAssessment(assessment);
    setActiveTab('preview');
  };

  const handleApplyHistoryAssessment = (assessment: AiAssessment) => {
    handleAcceptAssessment(assessment);
  };

  const handleAssessmentsCountChange = (count: number) => {
    setAssessmentsCount(count);
    setHasHistory(count > 0);
  };

  const handleAssessmentsDataChange = (assessmentsData: AiAssessment[]) => {
    setAssessments(assessmentsData);
    setAssessmentsCount(assessmentsData.length);
    setHasHistory(assessmentsData.length > 0);
  };

  // Determina qual avaliação mostrar no preview
  const previewAssessment = selectedHistoryAssessment || currentAssessment;

  return (
    <div className="w-full max-w-4xl mx-auto">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* Header com tabs - sempre visível */}
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="p-4 pb-0">
            <TabsList className="grid w-full grid-cols-4 h-12">
              <TabsTrigger 
                value="new" 
                className="flex items-center gap-1 text-xs sm:text-sm h-10 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200"
              >
                <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Nova Avaliação</span>
                <span className="sm:hidden">Nova</span>
              </TabsTrigger>
              <TabsTrigger 
                value="preview" 
                disabled={!previewAssessment} 
                className="flex items-center gap-1 text-xs sm:text-sm h-10 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200 disabled:opacity-50"
              >
                <Eye className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Preview</span>
                <span className="sm:hidden">Ver</span>
                {previewAssessment && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {selectedHistoryAssessment ? 
                      `#${assessments.findIndex(a => a.id === selectedHistoryAssessment.id) + 1}` : 
                      'Nova'
                    }
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="history" 
                className="flex items-center gap-1 text-xs sm:text-sm h-10 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200"
              >
                <History className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Histórico</span>
                <span className="sm:hidden">Hist</span>
                {assessmentsCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {assessmentsCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="config" 
                className="flex items-center gap-1 text-xs sm:text-sm h-10 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all duration-200"
              >
                <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Configurações</span>
                <span className="sm:hidden">Config</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Conteúdo com altura fixa e scroll interno */}
        <div className="p-4">
          <div className="min-h-[600px] max-h-[800px] overflow-hidden">
            <TabsContent value="new" className="mt-0 h-full">
              <div className="h-full flex flex-col justify-center">
                <div className="text-center space-y-6 py-8">
                  <div className="space-y-2">
                    <h3 className="text-xl font-semibold">Executar Nova Avaliação IA</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Gere uma nova avaliação usando inteligência artificial baseada no conteúdo do artigo
                    </p>
                  </div>
                  
                  <div className="flex justify-center">
                    <Badge variant="outline" className="text-xs px-3 py-1">
                      GPT-5 Mini • Temp: 0.0 • {configuration?.forceFileSearch ? 'RAG' : 'Direto'}
                    </Badge>
                  </div>

                  <div className="pt-4">
                    <Button
                      onClick={handleRunAIAssessment}
                      disabled={isProcessing}
                      size="lg"
                      className="w-full max-w-sm mx-auto h-12 text-base"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Processando...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-5 w-5" />
                          Executar Avaliação IA
                        </>
                      )}
                    </Button>
                  </div>

                  {hasHistory && (
                    <div className="pt-4">
                      <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 max-w-md mx-auto">
                        💡 Já existem {assessmentsCount} avaliação(ões) anterior(es). 
                        Veja o histórico para comparar resultados.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-0 h-full">
              <div className="h-full overflow-y-auto">
                {previewAssessment ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-4 border-b">
                      <h3 className="text-xl font-semibold">
                        {selectedHistoryAssessment ? 'Avaliação do Histórico' : 'Nova Avaliação'}
                      </h3>
                      {selectedHistoryAssessment && (
                        <Badge 
                          variant="outline" 
                          className={
                            selectedHistoryAssessment.status === 'accepted' ? 'border-green-500 text-green-700' :
                            selectedHistoryAssessment.status === 'rejected' ? 'border-red-500 text-red-700' :
                            'border-yellow-500 text-yellow-700'
                          }
                        >
                          {selectedHistoryAssessment.status === 'accepted' ? 'Aceita' : 
                           selectedHistoryAssessment.status === 'rejected' ? 'Rejeitada' : 'Pendente'}
                        </Badge>
                      )}
                    </div>
                    
                    <AIAssessmentPreview
                      assessment={{
                        selected_level: previewAssessment.selected_level,
                        confidence_score: previewAssessment.confidence_score,
                        justification: previewAssessment.justification,
                        evidence_passages: (previewAssessment.evidence_passages ?? []).map((e) => ({
                          text: e.text,
                          start_char: e.start_char ?? 0,
                          end_char: e.end_char ?? 0,
                          page_number: e.page_number ?? 0,
                          relevance_score: e.relevance_score ?? 0,
                        })),
                      }}
                      onAccept={() => handleAcceptAssessment(previewAssessment)}
                      onReject={() => handleRejectAssessment(previewAssessment)}
                    />
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center py-12 text-muted-foreground">
                      <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <h3 className="text-lg font-medium mb-2">Nenhuma avaliação selecionada</h3>
                      <p className="text-sm">Execute uma nova avaliação ou selecione uma do histórico</p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="history" className="mt-0 h-full">
              <div className="h-full overflow-hidden">
                <AIAssessmentHistory
                  projectId={projectId}
                  articleId={articleId}
                  assessmentItemId={assessmentItemId}
                  instrumentId={instrumentId}
                  onSelectAssessment={handleSelectHistoryAssessment}
                  onApplyAssessment={handleApplyHistoryAssessment}
                  onAssessmentsCountChange={handleAssessmentsCountChange}
                  onAssessmentsDataChange={handleAssessmentsDataChange}
                />
              </div>
            </TabsContent>

            <TabsContent value="config" className="mt-0 h-full">
              <div className="h-full overflow-y-auto">
                <AIConfigurationPanel
                  assessmentItemId={assessmentItemId}
                  itemQuestion={itemQuestion}
                  projectId={projectId}
                  onConfigurationChange={setConfiguration}
                />
              </div>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

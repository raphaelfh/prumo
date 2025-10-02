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
  evidence_passages: any[];
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
      setHasHistory((data?.length || 0) > 0);
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
    const clientTraceId = crypto.randomUUID();

    try {
      const pdfStorageKey = await getPdfStorageKey();

      // Prepara o payload com as configurações
      const payload: any = {
        projectId,
        articleId,
        assessmentItemId,
        instrumentId,
        pdf_storage_key: pdfStorageKey,
      };

      // Adiciona configurações personalizadas se disponíveis
      if (configuration) {
        if (configuration.forceFileSearch) {
          payload.force_file_search = true;
        }
        // Nota: model, temperature, maxTokens seriam configurados na edge function
        // Para implementação completa, seria necessário modificar a edge function
      }

      const { data, error } = await supabase.functions.invoke('ai-assessment', {
        body: payload,
        headers: {
          'x-client-trace-id': clientTraceId,
        },
      });

      if (error) {
        let traceFromBody: string | undefined;
        try {
          const parsed = JSON.parse(error.message);
          traceFromBody = parsed?.traceId;
        } catch {
          /* ignore */
        }
        throw new Error(
          `Falha ao invocar a avaliação de IA. ${error.message}${
            traceFromBody ? ` | traceId: ${traceFromBody}` : ''
          }`
        );
      }

      const assessment: AiAssessment | undefined = data?.assessment ?? data;
      if (!assessment) {
        throw new Error('Resposta da função sem assessment.');
      }

      setCurrentAssessment(assessment);
      setActiveTab('new'); // Mostra a nova avaliação
      
      // Atualiza o histórico
      checkHistory();

      const took =
        data?.processingTime != null
          ? (data.processingTime / 1000).toFixed(1)
          : ((performance.now() - t0) / 1000).toFixed(1);

      toast({
        title: 'Avaliação IA concluída',
        description: `Processado em ${took}s • traceId: ${data?.traceId ?? clientTraceId}`,
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

  // Determina qual avaliação mostrar no preview
  const previewAssessment = selectedHistoryAssessment || currentAssessment;

  return (
    <div className="w-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="p-4 pb-0">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="new" className="flex items-center gap-1 text-xs sm:text-sm">
              <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Nova Avaliação</span>
              <span className="sm:hidden">Nova</span>
            </TabsTrigger>
            <TabsTrigger value="preview" disabled={!previewAssessment} className="flex items-center gap-1 text-xs sm:text-sm">
              <Eye className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Preview</span>
              <span className="sm:hidden">Ver</span>
              {previewAssessment && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  1
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-1 text-xs sm:text-sm">
              <History className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Histórico</span>
              <span className="sm:hidden">Hist</span>
              {hasHistory && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  •
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="config" className="flex items-center gap-1 text-xs sm:text-sm">
              <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Configurações</span>
              <span className="sm:hidden">Config</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4">
          <TabsContent value="new" className="mt-0">
            <div className="text-center space-y-4 py-8">
              <div>
                <h3 className="text-lg font-medium">Executar Nova Avaliação IA</h3>
                <p className="text-sm text-muted-foreground">
                  Gere uma nova avaliação usando inteligência artificial
                </p>
              </div>
              
              <div className="flex justify-center">
                <Badge variant="outline" className="text-xs">
                  GPT-5 Mini • Temp: 0.0 • {configuration?.forceFileSearch ? 'RAG' : 'Direto'}
                </Badge>
              </div>

              <Button
                onClick={handleRunAIAssessment}
                disabled={isProcessing}
                size="lg"
                className="w-full max-w-md mx-auto"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Executar Avaliação IA
                  </>
                )}
              </Button>

              {hasHistory && (
                <p className="text-xs text-muted-foreground">
                  Já existem avaliações anteriores. Veja o histórico para comparar.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            {previewAssessment ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">
                    {selectedHistoryAssessment ? 'Avaliação do Histórico' : 'Nova Avaliação'}
                  </h3>
                  {selectedHistoryAssessment && (
                    <Badge variant="outline">
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
              <div className="text-center py-12 text-muted-foreground">
                <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Nenhuma avaliação selecionada para preview</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <AIAssessmentHistory
              projectId={projectId}
              articleId={articleId}
              assessmentItemId={assessmentItemId}
              instrumentId={instrumentId}
              onSelectAssessment={handleSelectHistoryAssessment}
              onApplyAssessment={handleApplyHistoryAssessment}
            />
          </TabsContent>

          <TabsContent value="config" className="mt-0">
            <AIConfigurationPanel
              assessmentItemId={assessmentItemId}
              itemQuestion={itemQuestion}
              projectId={projectId}
              onConfigurationChange={setConfiguration}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

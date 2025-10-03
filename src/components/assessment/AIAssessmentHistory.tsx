import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Clock, 
  Cpu, 
  Zap, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  ArrowRight,
  RotateCcw,
  Eye,
  RefreshCw
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AIAssessmentHistoryItem {
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
  prompt_tokens?: number;
  completion_tokens?: number;
  status: 'pending_review' | 'accepted' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  human_response?: string;
}

interface AIAssessmentHistoryProps {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;
  onSelectAssessment: (assessment: AIAssessmentHistoryItem) => void;
  onApplyAssessment: (assessment: AIAssessmentHistoryItem) => void;
  onAssessmentsCountChange?: (count: number) => void;
  onAssessmentsDataChange?: (assessments: AIAssessmentHistoryItem[]) => void;
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'accepted':
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case 'rejected':
      return <XCircle className="h-4 w-4 text-red-600" />;
    default:
      return <AlertCircle className="h-4 w-4 text-yellow-600" />;
  }
};

const getStatusLabel = (status: string) => {
  const labels = {
    pending_review: 'Pendente',
    accepted: 'Aceita',
    rejected: 'Rejeitada'
  };
  return labels[status as keyof typeof labels] || status;
};

const getLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    low: 'bg-green-100 text-green-800 border-green-300',
    high: 'bg-red-100 text-red-800 border-red-300',
    unclear: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    no_information: 'bg-gray-100 text-gray-800 border-gray-300',
  };
  return colors[level] || 'bg-blue-100 text-blue-800 border-blue-300';
};

const formatTokens = (tokens?: number) => {
  if (!tokens) return 'N/A';
  return tokens.toLocaleString('pt-BR');
};

const formatDuration = (ms?: number) => {
  if (!ms) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const AIAssessmentHistory = ({
  projectId,
  articleId,
  assessmentItemId,
  instrumentId,
  onSelectAssessment,
  onApplyAssessment,
  onAssessmentsCountChange,
  onAssessmentsDataChange
}: AIAssessmentHistoryProps) => {
  const [assessments, setAssessments] = useState<AIAssessmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAssessmentHistory();
  }, [projectId, articleId, assessmentItemId, instrumentId]);

  // Recarrega o histórico quando o componente recebe foco (útil para atualizações)
  useEffect(() => {
    const handleFocus = () => {
      loadAssessmentHistory();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [projectId, articleId, assessmentItemId, instrumentId]);

  const loadAssessmentHistory = async () => {
    setLoading(true);
    try {
      console.log('[AI Assessment History] Carregando histórico com parâmetros:', {
        projectId,
        articleId,
        assessmentItemId,
        instrumentId
      });

      // Verifica se o usuário está autenticado
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('[AI Assessment History] Usuário não autenticado');
        throw new Error('Usuário não autenticado');
      }

      const { data, error } = await supabase
        .from('ai_assessments')
        .select(`
          id,
          project_id,
          article_id,
          assessment_item_id,
          instrument_id,
          user_id,
          selected_level,
          confidence_score,
          justification,
          evidence_passages,
          ai_model_used,
          processing_time_ms,
          prompt_tokens,
          completion_tokens,
          status,
          created_at,
          reviewed_at,
          human_response
        `)
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('assessment_item_id', assessmentItemId)
        .eq('instrument_id', instrumentId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[AI Assessment History] Erro na consulta:', error);
        throw error;
      }

      console.log('[AI Assessment History] Dados recebidos:', {
        count: data?.length || 0,
        assessments: data?.map(a => ({ id: a.id, created_at: a.created_at, status: a.status }))
      });

      const assessmentsData = (data || []).map(item => ({
        ...item,
        evidence_passages: Array.isArray(item.evidence_passages) ? item.evidence_passages : [],
        status: item.status as 'pending_review' | 'accepted' | 'rejected'
      }));
      
      setAssessments(assessmentsData);
      
      // Notifica o componente pai sobre a mudança no count e dados
      if (onAssessmentsCountChange) {
        onAssessmentsCountChange(assessmentsData.length);
      }
      if (onAssessmentsDataChange) {
        onAssessmentsDataChange(assessmentsData);
      }
    } catch (error) {
      console.error('Error loading assessment history:', error);
      toast({
        title: 'Erro ao carregar histórico',
        description: 'Não foi possível carregar o histórico de avaliações da IA',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAssessment = (assessment: AIAssessmentHistoryItem) => {
    setSelectedId(assessment.id);
    onSelectAssessment(assessment);
  };

  const handleApplyAssessment = (assessment: AIAssessmentHistoryItem) => {
    onApplyAssessment(assessment);
    toast({
      title: 'Avaliação aplicada',
      description: 'A avaliação selecionada foi aplicada ao formulário'
    });
  };

  // Função para recarregar o histórico manualmente
  const refreshHistory = () => {
    loadAssessmentHistory();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RotateCcw className="h-4 w-4 animate-spin" />
            Carregando histórico...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (assessments.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhuma avaliação de IA encontrada para este item
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header fixo */}
      <div className="flex-shrink-0 p-4 border-b bg-background">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Histórico de Avaliações IA ({assessments.length})
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshHistory}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </div>

      {/* Lista com scroll */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {assessments.map((assessment, index) => (
              <Card 
                key={assessment.id}
                className={`cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.02] ${
                  selectedId === assessment.id ? 'ring-2 ring-primary shadow-lg' : ''
                }`}
                onClick={() => handleSelectAssessment(assessment)}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        #{assessments.length - index}
                      </Badge>
                      <Badge className={getLevelColor(assessment.selected_level)}>
                        {assessment.selected_level}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {Math.round(assessment.confidence_score * 100)}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(assessment.status)}
                      <span className="text-xs text-muted-foreground">
                        {getStatusLabel(assessment.status)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(assessment.created_at), { 
                      addSuffix: true, 
                      locale: ptBR 
                    })}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Justificativa */}
                  <div>
                    <p className="text-sm line-clamp-3 leading-relaxed">
                      {assessment.justification}
                    </p>
                  </div>

                  <Separator />

                  {/* Metadados técnicos - responsivo */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-3 w-3 flex-shrink-0" />
                        <span className="font-medium">Modelo:</span>
                        <span className="text-muted-foreground truncate">{assessment.ai_model_used}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span className="font-medium">Tempo:</span>
                        <span className="text-muted-foreground">
                          {formatDuration(assessment.processing_time_ms)}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Zap className="h-3 w-3 flex-shrink-0" />
                        <span className="font-medium">Tokens:</span>
                        <span className="text-muted-foreground text-xs">
                          {formatTokens(assessment.prompt_tokens)}→{formatTokens(assessment.completion_tokens)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Eye className="h-3 w-3 flex-shrink-0" />
                        <span className="font-medium">Evidências:</span>
                        <span className="text-muted-foreground">
                          {assessment.evidence_passages?.length || 0}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Ações - responsivo */}
                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectAssessment(assessment);
                      }}
                      className="flex-1"
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Visualizar
                    </Button>
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApplyAssessment(assessment);
                      }}
                      className="flex-1"
                    >
                      <ArrowRight className="h-3 w-3 mr-1" />
                      Aplicar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
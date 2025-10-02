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
  Eye
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AIAssessmentHistoryItem {
  id: string;
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
  onApplyAssessment
}: AIAssessmentHistoryProps) => {
  const [assessments, setAssessments] = useState<AIAssessmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAssessmentHistory();
  }, [projectId, articleId, assessmentItemId, instrumentId]);

  const loadAssessmentHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_assessments')
        .select('*')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('assessment_item_id', assessmentItemId)
        .eq('instrument_id', instrumentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssessments(data || []);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Histórico de Avaliações IA ({assessments.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {assessments.map((assessment, index) => (
              <Card 
                key={assessment.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedId === assessment.id ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => handleSelectAssessment(assessment)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
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
                    <p className="text-sm line-clamp-3">
                      {assessment.justification}
                    </p>
                  </div>

                  <Separator />

                  {/* Metadados técnicos */}
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Cpu className="h-3 w-3" />
                        <span className="font-medium">Modelo:</span>
                        <span className="text-muted-foreground">{assessment.ai_model_used}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span className="font-medium">Tempo:</span>
                        <span className="text-muted-foreground">
                          {formatDuration(assessment.processing_time_ms)}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        <span className="font-medium">Tokens:</span>
                        <span className="text-muted-foreground">
                          {formatTokens(assessment.prompt_tokens)}→{formatTokens(assessment.completion_tokens)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        <span className="font-medium">Evidências:</span>
                        <span className="text-muted-foreground">
                          {assessment.evidence_passages?.length || 0}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex gap-2 pt-2">
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
      </CardContent>
    </Card>
  );
};

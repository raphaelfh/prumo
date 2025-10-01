import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Evidence {
  text: string;
  start_char: number;
  end_char: number;
  page_number: number;
  relevance_score: number;
}

interface AIAssessmentPreviewProps {
  assessment: {
    selected_level: string;
    confidence_score: number;
    justification: string;
    evidence_passages: Evidence[];
  };
  onAccept: () => void;
  onReject: () => void;
}

const getLevelColor = (level: string) => {
  const colors: Record<string, string> = {
    low: 'bg-green-100 text-green-800 border-green-300',
    high: 'bg-red-100 text-red-800 border-red-300',
    unclear: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    no_information: 'bg-gray-100 text-gray-800 border-gray-300',
  };
  return colors[level] || 'bg-gray-100 text-gray-800 border-gray-300';
};

const getLevelLabel = (level: string) => {
  const labels: Record<string, string> = {
    low: 'Baixo Risco',
    high: 'Alto Risco',
    unclear: 'Não Claro',
    no_information: 'Sem Informação',
  };
  return labels[level] || level;
};

export const AIAssessmentPreview = ({
  assessment,
  onAccept,
  onReject
}: AIAssessmentPreviewProps) => {
  const [showEvidence, setShowEvidence] = useState(false);

  const confidencePercentage = Math.round(assessment.confidence_score * 100);

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            🤖 Avaliação da IA
            <Badge variant="outline" className="text-xs">
              {confidencePercentage}% confiança
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-2">Nível selecionado:</p>
          <Badge className={getLevelColor(assessment.selected_level)}>
            {getLevelLabel(assessment.selected_level)}
          </Badge>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Justificativa:</p>
          <p className="text-sm">{assessment.justification}</p>
        </div>

        {assessment.evidence_passages.length > 0 && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowEvidence(!showEvidence)}
              className="w-full justify-between p-2 h-auto"
            >
              <span className="text-xs text-muted-foreground">
                {assessment.evidence_passages.length} evidência(s) encontrada(s)
              </span>
              {showEvidence ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>

            {showEvidence && (
              <ScrollArea className="h-[200px] mt-2 rounded-md border p-3">
                <div className="space-y-3">
                  {assessment.evidence_passages.map((evidence, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-md bg-muted/50 text-sm space-y-1"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          Página {evidence.page_number}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {Math.round(evidence.relevance_score * 100)}% relevante
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed">{evidence.text}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-2 pt-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onAccept}
          className="flex-1 gap-2"
        >
          <Check className="h-4 w-4" />
          Aceitar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReject}
          className="flex-1 gap-2"
        >
          <X className="h-4 w-4" />
          Rejeitar
        </Button>
      </CardFooter>
    </Card>
  );
};
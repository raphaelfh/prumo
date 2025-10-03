import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { OtherAssessment } from '@/hooks/assessment/useOtherAssessments';

interface AssessmentComparisonCardProps {
  assessments: OtherAssessment[];
  currentResponses: Record<string, { level: string; comment?: string }>;
  className?: string;
}

export const AssessmentComparisonCard = ({ 
  assessments, 
  currentResponses,
  className 
}: AssessmentComparisonCardProps) => {
  if (assessments.length === 0) {
    return null;
  }

  const getLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      'high': 'bg-green-100 text-green-800 border-green-200',
      'low': 'bg-red-100 text-red-800 border-red-200',
      'unclear': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'uncertain': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'no_information': 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[level] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getLevelLabel = (level: string) => {
    const labels: Record<string, string> = {
      'high': 'Alto',
      'low': 'Baixo',
      'unclear': 'Incerto',
      'uncertain': 'Incerto',
      'no_information': 'Sem Info',
    };
    return labels[level] || level;
  };

  // Calcular concordância por item
  const calculateItemConcordance = (itemId: string) => {
    const currentLevel = currentResponses[itemId]?.level;
    if (!currentLevel) return { isConcordant: null, otherLevels: [] };

    const otherLevels = assessments
      .map(assessment => assessment.responses?.[itemId]?.level)
      .filter(Boolean);

    const isConcordant = otherLevels.length > 0 && otherLevels.every(level => level === currentLevel);
    
    return { isConcordant, otherLevels };
  };

  // Obter todos os item IDs únicos
  const allItemIds = new Set<string>();
  assessments.forEach(assessment => {
    Object.keys(assessment.responses || {}).forEach(itemId => {
      allItemIds.add(itemId);
    });
  });
  Object.keys(currentResponses).forEach(itemId => {
    allItemIds.add(itemId);
  });

  const itemIds = Array.from(allItemIds);

  return (
    <Card className={`border-l-4 border-l-blue-500 h-full ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-600" />
          Comparação com Outros ({assessments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 h-full">
        <ScrollArea className="h-full">
          <div className="space-y-4">
            {assessments.map((assessment) => (
              <div key={assessment.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 truncate">
                    {assessment.user_name}
                  </span>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {assessment.completion_percentage}%
                  </Badge>
                </div>
                
                {/* Scroll horizontal para questões */}
                <ScrollArea orientation="horizontal" className="w-full scrollbar-horizontal">
                  <div className="flex gap-3 pb-2" style={{ minWidth: 'max-content' }}>
                    {itemIds.map((itemId) => {
                      const response = assessment.responses?.[itemId];
                      const { isConcordant } = calculateItemConcordance(itemId);
                      
                      if (!response) return null;

                      return (
                        <div key={itemId} className="flex-shrink-0 w-32 space-y-2">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-xs font-mono text-gray-500">
                              {itemId}
                            </span>
                            {isConcordant !== null && (
                              isConcordant ? (
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              ) : (
                                <AlertTriangle className="h-3 w-3 text-orange-600" />
                              )
                            )}
                          </div>
                          <Badge 
                            variant="outline" 
                            className={`text-xs w-full justify-center ${getLevelColor(response.level)}`}
                          >
                            {getLevelLabel(response.level)}
                          </Badge>
                          {response.comment && (
                            <div className="p-2 bg-gray-50 rounded-md">
                              <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                                {response.comment}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

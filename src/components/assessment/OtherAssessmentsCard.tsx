import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, MessageSquare, Users } from 'lucide-react';
import { OtherAssessment } from '@/hooks/assessment/useOtherAssessments';

interface OtherAssessmentsCardProps {
  assessments: OtherAssessment[];
  className?: string;
  variant?: 'default' | 'compact' | 'horizontal';
  showHeader?: boolean;
}

export const OtherAssessmentsCard = ({ 
  assessments, 
  className,
  variant = 'default',
  showHeader = true
}: OtherAssessmentsCardProps) => {
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

  // Layout horizontal para modo blind off
  if (variant === 'horizontal') {
    return (
      <Card className={`border-l-4 border-l-blue-500 h-full ${className}`}>
        {showHeader && (
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              Outros Revisores ({assessments.length})
            </CardTitle>
          </CardHeader>
        )}
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
                      {Object.entries(assessment.responses || {}).map(([itemId, response]) => (
                        <div key={itemId} className="flex-shrink-0 w-32 space-y-2">
                          <div className="text-xs font-mono text-gray-500 text-center">
                            {itemId}
                          </div>
                          <Badge 
                            variant="outline" 
                            className={`text-xs w-full justify-center ${getLevelColor(response.level)}`}
                          >
                            {getLevelLabel(response.level)}
                          </Badge>
                          {response.comment && (
                            <div className="p-2 bg-gray-50 rounded-md">
                              <div className="flex items-start gap-1">
                                <MessageSquare className="h-3 w-3 text-gray-400 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                                  {response.comment}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  // Layout compacto para sidebar
  if (variant === 'compact') {
    return (
      <Card className={`border-l-4 border-l-blue-500 h-full ${className}`}>
        {showHeader && (
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              Outros ({assessments.length})
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="p-3 pt-0 h-full">
          <ScrollArea className="h-full">
            <div className="space-y-3">
              {assessments.map((assessment) => (
                <div key={assessment.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700 truncate">
                      {assessment.user_name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {assessment.completion_percentage}%
                    </Badge>
                  </div>
                  
                  <div className="space-y-1">
                    {Object.entries(assessment.responses || {}).slice(0, 3).map(([itemId, response]) => (
                      <div key={itemId} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-500 w-8 truncate">
                          {itemId}
                        </span>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${getLevelColor(response.level)}`}
                        >
                          {getLevelLabel(response.level)}
                        </Badge>
                      </div>
                    ))}
                    {Object.keys(assessment.responses || {}).length > 3 && (
                      <div className="text-xs text-gray-500 text-center">
                        +{Object.keys(assessment.responses || {}).length - 3} mais
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  // Layout padrão (original)
  return (
    <Card className={`border-l-4 border-l-blue-500 ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <User className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-medium text-blue-900">
            Avaliações de outros revisores ({assessments.length})
          </span>
        </div>
        
        <ScrollArea className="max-h-64">
          <div className="space-y-3">
            {assessments.map((assessment, index) => (
              <div key={assessment.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    {assessment.user_name}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {assessment.completion_percentage}% completo
                  </Badge>
                </div>
                
                {Object.entries(assessment.responses || {}).map(([itemId, response]) => (
                  <div key={itemId} className="ml-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-500">
                        {itemId}
                      </span>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${getLevelColor(response.level)}`}
                      >
                        {getLevelLabel(response.level)}
                      </Badge>
                    </div>
                    
                    {response.comment && (
                      <div className="ml-2 p-2 bg-gray-50 rounded-md">
                        <div className="flex items-start gap-2">
                          <MessageSquare className="h-3 w-3 text-gray-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-gray-600 leading-relaxed">
                            {response.comment}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

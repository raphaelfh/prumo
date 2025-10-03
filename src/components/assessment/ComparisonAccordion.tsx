import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssessmentItem } from "@/hooks/assessment/useAssessmentInstruments";
import { OtherAssessment } from "@/hooks/assessment/useOtherAssessments";
import { Users, CheckCircle, AlertTriangle } from "lucide-react";

interface ComparisonAccordionProps {
  domain: string;
  domainName: string;
  items: AssessmentItem[];
  currentResponses: Record<string, { level: string; comment?: string }>;
  otherAssessments: OtherAssessment[];
  instrumentAllowedLevels: string[];
}

export const ComparisonAccordion = ({
  domain,
  domainName,
  items,
  currentResponses,
  otherAssessments,
  instrumentAllowedLevels,
}: ComparisonAccordionProps) => {
  const domainItems = items.filter((item) => item.domain === domain);
  
  const getItemAllowedLevels = (item: AssessmentItem) => {
    const levels = item.allowed_levels || instrumentAllowedLevels;
    return typeof levels === 'string' ? JSON.parse(levels) : Array.isArray(levels) ? levels : [];
  };

  const getLevelLabel = (level: string) => {
    const labels: Record<string, string> = {
      low: "Baixo",
      high: "Alto",
      unclear: "Incerto",
      uncertain: "Incerto",
      no_information: "Sem Informação",
    };
    return labels[level] || level;
  };

  const getLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      low: "bg-red-100 text-red-800 border-red-200",
      high: "bg-green-100 text-green-800 border-green-200",
      unclear: "bg-yellow-100 text-yellow-800 border-yellow-200",
      uncertain: "bg-yellow-100 text-yellow-800 border-yellow-200",
      no_information: "bg-gray-100 text-gray-800 border-gray-200",
    };
    return colors[level] || "bg-gray-100 text-gray-800 border-gray-200";
  };

  const getOtherResponsesForItem = (itemCode: string) => {
    return otherAssessments.map(assessment => {
      const response = assessment.responses?.[itemCode];
      return response ? {
        user_name: assessment.user_name || 'Usuário',
        level: response.level,
        comment: response.comment
      } : null;
    }).filter(Boolean);
  };

  const getConcordanceForItem = (itemCode: string) => {
    const currentLevel = currentResponses[itemCode]?.level;
    const otherResponses = getOtherResponsesForItem(itemCode);
    
    if (!currentLevel || otherResponses.length === 0) {
      return { isConcordant: null, otherLevels: [] };
    }

    const otherLevels = otherResponses.map(r => r.level);
    const isConcordant = otherLevels.every(level => level === currentLevel);
    
    return { isConcordant, otherLevels };
  };

  if (domainItems.length === 0) {
    return null;
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={domain}>
        <AccordionTrigger className="text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium">{domainName}</span>
            <Badge variant="outline" className="text-xs">
              {domainItems.length} questões
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {domainItems.map((item) => {
              const currentResponse = currentResponses[item.item_code];
              const otherResponses = getOtherResponsesForItem(item.item_code);
              const { isConcordant } = getConcordanceForItem(item.item_code);
              const allowedLevels = getItemAllowedLevels(item);

              return (
                <Card key={item.item_code} className="border-l-4 border-l-blue-500">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">{item.item_code}</span>
                      {isConcordant !== null && (
                        isConcordant ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-orange-600" />
                        )
                      )}
                    </CardTitle>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {item.question}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-4">
                      {/* Sua Resposta */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium text-blue-900">Sua Resposta</span>
                        </div>
                        {currentResponse ? (
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant="outline" 
                              className={`text-sm ${getLevelColor(currentResponse.level)}`}
                            >
                              {getLevelLabel(currentResponse.level)}
                            </Badge>
                            {currentResponse.comment && (
                              <span className="text-xs text-gray-600 italic">
                                "{currentResponse.comment}"
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500 italic">Não respondida</span>
                        )}
                      </div>

                      {/* Respostas de Outros Usuários */}
                      {otherResponses.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-gray-600" />
                            <span className="text-sm font-medium text-gray-700">
                              Outros Revisores ({otherResponses.length})
                            </span>
                          </div>
                          <div className="space-y-2">
                            {otherResponses.map((response, index) => (
                              <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                                <span className="text-xs font-medium text-gray-600 min-w-[80px]">
                                  {response.user_name}:
                                </span>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getLevelColor(response.level)}`}
                                >
                                  {getLevelLabel(response.level)}
                                </Badge>
                                {response.comment && (
                                  <span className="text-xs text-gray-600 italic flex-1">
                                    "{response.comment}"
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Opções Disponíveis */}
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-gray-500">Opções disponíveis:</span>
                        <div className="flex flex-wrap gap-1">
                          {allowedLevels.map((level) => (
                            <Badge 
                              key={level} 
                              variant="outline" 
                              className={`text-xs ${getLevelColor(level)}`}
                            >
                              {getLevelLabel(level)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AssessmentItem } from "@/hooks/assessment/useAssessmentInstruments";
import { OtherAssessment } from "@/hooks/assessment/useOtherAssessments";
import { ComparisonAccordion } from "./ComparisonAccordion";
import { Users, BarChart3, CheckCircle, AlertTriangle, User, X, TrendingUp } from "lucide-react";

interface AssessmentComparisonViewProps {
  items: AssessmentItem[];
  currentResponses: Record<string, { level: string; comment?: string }>;
  otherAssessments: OtherAssessment[];
  instrumentAllowedLevels: string[];
  schema: any;
  className?: string;
}

export const AssessmentComparisonView = ({
  items,
  currentResponses,
  otherAssessments,
  instrumentAllowedLevels,
  schema,
  className
}: AssessmentComparisonViewProps) => {
  // Agrupar itens por domínio
  const domains = Array.from(new Set(items.map(item => item.domain)));
  
  // Extrair nomes dos domínios do schema
  const domainNames = domains.reduce((acc, domain) => {
    const domainInfo = schema?.domains?.find((d: any) => d.code === domain);
    acc[domain] = domainInfo?.name || `Domínio ${domain}`;
    return acc;
  }, {} as Record<string, string>);

  // Calcular estatísticas
  const totalItems = items.length;
  const currentCompletedItems = Object.keys(currentResponses).length;
  const otherUsersCount = otherAssessments.length;

  // Calcular concordância geral
  const concordantItems = items.filter(item => {
    const currentLevel = currentResponses[item.item_code]?.level;
    if (!currentLevel) return false;
    
    const otherResponses = otherAssessments
      .map(assessment => assessment.responses?.[item.item_code]?.level)
      .filter(Boolean);
    
    if (otherResponses.length === 0) return false;
    
    return otherResponses.every(level => level === currentLevel);
  }).length;

  const concordancePercentage = totalItems > 0 ? Math.round((concordantItems / totalItems) * 100) : 0;

  // Calcular resumo por pessoa
  const getPersonSummary = () => {
    return otherAssessments.map(assessment => {
      const personItems = items.filter(item => {
        const currentLevel = currentResponses[item.item_code]?.level;
        const personLevel = assessment.responses?.[item.item_code]?.level;
        return currentLevel && personLevel;
      });

      const concordantWithPerson = personItems.filter(item => {
        const currentLevel = currentResponses[item.item_code]?.level;
        const personLevel = assessment.responses?.[item.item_code]?.level;
        return currentLevel === personLevel;
      }).length;

      const concordanceWithPerson = personItems.length > 0 
        ? Math.round((concordantWithPerson / personItems.length) * 100) 
        : 0;

      return {
        name: assessment.user_name || 'Usuário',
        totalItems: personItems.length,
        concordantItems: concordantWithPerson,
        concordancePercentage: concordanceWithPerson,
        isHighConcordance: concordanceWithPerson >= 80,
        isMediumConcordance: concordanceWithPerson >= 60 && concordanceWithPerson < 80,
        isLowConcordance: concordanceWithPerson < 60
      };
    });
  };

  const personSummaries = getPersonSummary();

  // Calcular itens por domínio com concordância
  const getDomainItemsSummary = () => {
    return domains.map(domain => {
      const domainItems = items.filter(item => item.domain === domain);
      const domainName = domainNames[domain];
      
      const itemsWithConcordance = domainItems.map(item => {
        const currentLevel = currentResponses[item.item_code]?.level;
        if (!currentLevel) {
          return {
            itemCode: item.item_code,
            question: item.question,
            isConcordant: null,
            hasResponse: false
          };
        }

        const otherResponses = otherAssessments
          .map(assessment => assessment.responses?.[item.item_code]?.level)
          .filter(Boolean);

        if (otherResponses.length === 0) {
          return {
            itemCode: item.item_code,
            question: item.question,
            isConcordant: null,
            hasResponse: true
          };
        }

        const isConcordant = otherResponses.every(level => level === currentLevel);
        
        return {
          itemCode: item.item_code,
          question: item.question,
          isConcordant,
          hasResponse: true
        };
      });

      const concordantItems = itemsWithConcordance.filter(item => item.isConcordant === true).length;
      const totalResponses = itemsWithConcordance.filter(item => item.hasResponse).length;
      const discordantItems = itemsWithConcordance.filter(item => item.isConcordant === false).length;

      return {
        domain,
        domainName,
        items: itemsWithConcordance,
        concordantItems,
        discordantItems,
        totalResponses,
        concordancePercentage: totalResponses > 0 ? Math.round((concordantItems / totalResponses) * 100) : 0
      };
    });
  };

  const domainSummaries = getDomainItemsSummary();

  return (
    <Card className={`h-full ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" />
          Comparação com Outros Revisores
        </CardTitle>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            <span>{otherUsersCount} outros revisores</span>
          </div>
          <Badge variant="outline" className="text-xs">
            {concordancePercentage}% concordância geral
          </Badge>
          <Badge variant="outline" className="text-xs">
            {currentCompletedItems}/{totalItems} questões
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 max-h-[60vh] overflow-y-auto">
        <Accordion type="single" collapsible className="w-full">
          {/* Resumo Accordion */}
          <AccordionItem value="summary" className="border-l-4 border-l-purple-500 bg-purple-50/30">
            <AccordionTrigger className="text-base font-semibold text-purple-700 hover:text-purple-800 hover:no-underline">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-purple-600" />
                Resumo da Comparação
              </div>
              <Badge variant="secondary" className="ml-2 bg-purple-100 text-purple-700">
                {personSummaries.length + domainSummaries.length} itens
              </Badge>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-4">
                {/* Resumo por pessoa */}
                {personSummaries.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-500">Resumo por pessoa:</div>
                    <div className="flex flex-wrap gap-2">
                      {personSummaries.map((summary, index) => (
                        <div
                          key={index}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border ${
                            summary.isHighConcordance 
                              ? 'bg-green-50 text-green-700 border-green-200' 
                              : summary.isMediumConcordance
                              ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}
                        >
                          <User className="h-3 w-3" />
                          <span className="font-medium truncate max-w-[80px]">
                            {summary.name}
                          </span>
                          <div className="flex items-center gap-1">
                            {summary.isHighConcordance ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            <span className="font-mono">
                              {summary.concordancePercentage}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Resumo por domínio */}
                {domainSummaries.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-500">Itens por domínio:</div>
                    <div className="space-y-2">
                      {domainSummaries.map((domainSummary, index) => (
                        <div key={index} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-700">
                              {domainSummary.domainName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {domainSummary.concordancePercentage}% concordância
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {domainSummary.items.map((item, itemIndex) => (
                              <div
                                key={itemIndex}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${
                                  item.isConcordant === true
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : item.isConcordant === false
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : 'bg-gray-50 text-gray-600 border-gray-200'
                                }`}
                              >
                                <span className="font-mono text-xs">
                                  {item.itemCode}
                                </span>
                                {item.isConcordant === true && (
                                  <CheckCircle className="h-3 w-3" />
                                )}
                                {item.isConcordant === false && (
                                  <X className="h-3 w-3" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Domínios Accordions */}
          {domains.map((domain) => (
            <ComparisonAccordion
              key={domain}
              domain={domain}
              domainName={domainNames[domain] || domain}
              items={items}
              currentResponses={currentResponses}
              otherAssessments={otherAssessments}
              instrumentAllowedLevels={instrumentAllowedLevels}
            />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
};

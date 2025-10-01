import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AssessmentItem } from "@/hooks/assessment/useAssessmentInstruments";
import { Badge } from "@/components/ui/badge";
import { AIAssessmentButton } from "./AIAssessmentButton";

interface DomainAccordionProps {
  domain: string;
  domainName: string;
  items: AssessmentItem[];
  responses: Record<string, { level: string; comment?: string }>;
  instrumentAllowedLevels: string[];
  onResponseChange: (itemCode: string, level: string) => void;
  onCommentChange: (itemCode: string, comment: string) => void;
  disabled?: boolean;
  projectId?: string;
  articleId?: string;
  instrumentId?: string;
}

export const DomainAccordion = ({
  domain,
  domainName,
  items,
  responses,
  instrumentAllowedLevels,
  onResponseChange,
  onCommentChange,
  disabled = false,
  projectId,
  articleId,
  instrumentId,
}: DomainAccordionProps) => {
  const domainItems = items.filter((item) => item.domain === domain);
  const completedItems = domainItems.filter((item) => responses[item.item_code]?.level);
  const progress = domainItems.length > 0 ? (completedItems.length / domainItems.length) * 100 : 0;
  
  const getItemAllowedLevels = (item: AssessmentItem) => {
    // Use item's allowed_levels if available, otherwise fall back to instrument's
    const levels = item.allowed_levels || instrumentAllowedLevels;
    return typeof levels === 'string' ? JSON.parse(levels) : Array.isArray(levels) ? levels : [];
  };

  const getLevelLabel = (level: string) => {
    const labels: Record<string, string> = {
      low: "Baixo",
      high: "Alto",
      unclear: "Incerto",
      no_information: "Sem Informação",
    };
    return labels[level] || level;
  };

  const getLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      low: "bg-success",
      high: "bg-destructive",
      unclear: "bg-warning",
      no_information: "bg-muted",
    };
    return colors[level] || "bg-muted";
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={domain}>
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center justify-between w-full pr-4">
            <span className="font-semibold">{domainName}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {completedItems.length}/{domainItems.length}
              </Badge>
              <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-6 pt-4">
            {domainItems.map((item) => (
              <div key={item.id} className="space-y-3 p-4 rounded-lg border bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <Label className="text-sm font-medium leading-relaxed">
                      {item.item_code}. {item.question}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    {projectId && articleId && instrumentId && (
                      <AIAssessmentButton
                        projectId={projectId}
                        articleId={articleId}
                        assessmentItemId={item.id}
                        instrumentId={instrumentId}
                        itemQuestion={item.question}
                        onAccept={(level, comment) => {
                          onResponseChange(item.item_code, level);
                          onCommentChange(item.item_code, comment);
                        }}
                      />
                    )}
                    {responses[item.item_code]?.level && (
                      <Badge className={getLevelColor(responses[item.item_code].level)}>
                        {getLevelLabel(responses[item.item_code].level)}
                      </Badge>
                    )}
                  </div>
                </div>

                <RadioGroup
                  value={responses[item.item_code]?.level || ""}
                  onValueChange={(value) => {
                    // Toggle: if clicking the same option, deselect it
                    if (responses[item.item_code]?.level === value) {
                      onResponseChange(item.item_code, "");
                    } else {
                      onResponseChange(item.item_code, value);
                    }
                  }}
                  disabled={disabled}
                  className="grid grid-cols-2 gap-2 mt-3"
                >
                  {getItemAllowedLevels(item).map((level: string) => (
                    <div key={level} className="flex items-center space-x-2 border rounded-md p-3 hover:bg-accent">
                      <RadioGroupItem value={level} id={`${item.item_code}-${level}`} />
                      <Label htmlFor={`${item.item_code}-${level}`} className="cursor-pointer flex-1 font-normal">
                        {getLevelLabel(level)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>

                <div className="space-y-2 mt-3">
                  <Label htmlFor={`comment-${item.item_code}`} className="text-xs text-muted-foreground">
                    Comentários/Justificativa (opcional)
                  </Label>
                  <Textarea
                    id={`comment-${item.item_code}`}
                    placeholder="Adicione comentários ou justificativa para sua avaliação..."
                    value={responses[item.item_code]?.comment || ""}
                    onChange={(e) => onCommentChange(item.item_code, e.target.value)}
                    disabled={disabled}
                    className="min-h-[80px] resize-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

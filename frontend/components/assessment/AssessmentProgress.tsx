import {Progress} from "@/components/ui/progress";
import {Badge} from "@/components/ui/badge";

interface AssessmentProgressProps {
  completionPercentage: number;
  status: "in_progress" | "submitted" | "reviewed" | "archived" | "locked";
}

export const AssessmentProgress = ({ completionPercentage, status }: AssessmentProgressProps) => {
  const getStatusColor = () => {
    switch (status) {
      case "submitted":
        return "bg-success";
      case "reviewed":
        return "bg-info";
      case "locked":
        return "bg-muted";
      case "archived":
        return "bg-muted";
      default:
        return "bg-warning";
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "submitted":
        return "Completo";
      case "reviewed":
        return "Revisado";
      case "locked":
        return "Bloqueado";
      case "archived":
        return "Arquivado";
      default:
        return "Em progresso";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Progresso</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{completionPercentage}%</span>
          <Badge variant="outline" className={getStatusColor()}>
            {getStatusLabel()}
          </Badge>
        </div>
      </div>
      <Progress value={completionPercentage} className="h-2" />
    </div>
  );
};

/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Tab de Histórico de Extrações
 * 
 * Lista extraction_runs anteriores (section-extraction pipeline) com suas estatísticas.
 * Funciona para histórico de extrações granulares por seção.
 * 
 * @component
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { History, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useExtractionRuns } from "@/hooks/extraction/ai/useExtractionRuns";

interface ExtractionHistoryTabProps {
  articleId: string;
  templateId: string;
}

export function ExtractionHistoryTab(props: ExtractionHistoryTabProps) {
  const { articleId, templateId } = props;
  const { runs, loading } = useExtractionRuns({ articleId, templateId });

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24 mt-2" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12">
        <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h4 className="font-medium mb-2">Nenhuma extração anterior</h4>
        <p className="text-sm text-muted-foreground">
          Execute uma extração para começar o histórico
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-3">
        {runs.map((run) => {
          const isCompleted = run.status === "completed";
          const isFailed = run.status === "failed";
          const isRunning = run.status === "running";

          return (
            <Card key={run.id} className="hover:border-primary/50 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      {isCompleted && <CheckCircle className="h-4 w-4 text-green-600" />}
                      {isFailed && <XCircle className="h-4 w-4 text-red-600" />}
                      {isRunning && <Clock className="h-4 w-4 text-blue-600 animate-pulse" />}
                      Extração #{run.id.substring(0, 8)}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {format(new Date(run.startedAt || run.createdAt), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={isCompleted ? "default" : isFailed ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {run.status === "completed" && "Concluída"}
                    {run.status === "failed" && "Falhou"}
                    {run.status === "running" && "Em execução"}
                    {run.status === "pending" && "Pendente"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="pb-3">
                {isCompleted && run.metadata && (
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sugestões criadas:</span>
                      <span className="font-medium">{run.metadata.suggestionsCreated || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tokens usados:</span>
                      <span className="font-medium tabular-nums">
                        {(run.metadata.tokensUsed || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Páginas do PDF:</span>
                      <span className="font-medium tabular-nums">{run.metadata.pdfPages || 0}</span>
                    </div>
                  </div>
                )}

                {isFailed && run.metadata?.errorMessage && (
                  <div className="text-xs text-red-600 dark:text-red-400">
                    <p className="font-medium mb-1">Erro:</p>
                    <p className="text-muted-foreground">{run.metadata.errorMessage}</p>
                  </div>
                )}

                {isRunning && (
                  <div className="text-xs text-blue-600 dark:text-blue-400">
                    <p>Processamento em andamento...</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}


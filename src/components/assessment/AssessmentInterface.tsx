import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAssessmentInstruments } from "@/hooks/assessment/useAssessmentInstruments";
import { InstrumentSelector } from "./InstrumentSelector";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface AssessmentInterfaceProps {
  projectId: string;
}

export const AssessmentInterface = ({ projectId }: AssessmentInterfaceProps) => {
  const navigate = useNavigate();
  const { instruments, loading: instrumentsLoading } = useAssessmentInstruments();
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadArticles();
    loadAssessments();
  }, [projectId]);

  // Auto-seleciona o primeiro instrumento quando disponível
  useEffect(() => {
    if (!selectedInstrument && instruments.length > 0) {
      setSelectedInstrument(instruments[0].id);
    }
  }, [instruments, selectedInstrument]);

  const loadArticles = async () => {
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error("Error loading articles:", error);
      toast.error("Erro ao carregar artigos");
    } finally {
      setLoading(false);
    }
  };

  const loadAssessments = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("assessments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id);

      if (error) throw error;
      setAssessments(data || []);
    } catch (error: any) {
      console.error("Error loading assessments:", error);
    }
  };

  const getArticleAssessment = (articleId: string) => {
    return assessments.find((a) => a.article_id === articleId && a.instrument_id === selectedInstrument);
  };

  const handleStartAssessment = (article: any) => {
    if (!selectedInstrument) {
      toast.error("Selecione um instrumento primeiro");
      return;
    }
    navigate(`/projects/${projectId}/assessment/${article.id}/${selectedInstrument}`);
  };

  const getStatusBadge = (assessment: any) => {
    if (!assessment) {
      return <Badge variant="outline">Não iniciado</Badge>;
    }
    
    const statusColors: Record<string, string> = {
      in_progress: "bg-warning",
      submitted: "bg-success",
      reviewed: "bg-info",
      locked: "bg-muted",
      archived: "bg-muted",
    };

    const statusLabels: Record<string, string> = {
      in_progress: "Em progresso",
      submitted: "Completo",
      reviewed: "Revisado",
      locked: "Bloqueado",
      archived: "Arquivado",
    };

    return (
      <Badge className={statusColors[assessment.status] || "bg-muted"}>
        {statusLabels[assessment.status] || assessment.status}
      </Badge>
    );
  };

  const selectedInstrumentData = instruments.find((i) => i.id === selectedInstrument);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuração da Avaliação</CardTitle>
          <CardDescription>Selecione o instrumento de avaliação</CardDescription>
        </CardHeader>
        <CardContent>
          <InstrumentSelector
            instruments={instruments}
            value={selectedInstrument}
            onValueChange={setSelectedInstrument}
          />
        </CardContent>
      </Card>

      {selectedInstrument && (
        <Card>
          <CardHeader>
            <CardTitle>Artigos para Avaliação</CardTitle>
            <CardDescription>
              Clique em "Avaliar" para iniciar ou continuar a avaliação de um artigo
            </CardDescription>
          </CardHeader>
          <CardContent>
            {articles.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Nenhum artigo disponível para avaliação</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progresso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.map((article) => {
                    const assessment = getArticleAssessment(article.id);
                    return (
                      <TableRow key={article.id}>
                        <TableCell className="font-medium max-w-md truncate">
                          {article.title}
                        </TableCell>
                        <TableCell>{getStatusBadge(assessment)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <Progress value={assessment?.completion_percentage || 0} className="h-2" />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {assessment?.completion_percentage || 0}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={assessment ? "outline" : "default"}
                            onClick={() => handleStartAssessment(article)}
                          >
                            {assessment ? "Continuar" : "Iniciar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

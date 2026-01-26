/**
 * Interface principal para avaliação de artigos
 * 
 * Componente que gerencia todo o fluxo de avaliação de artigos
 * para um projeto específico, incluindo instrumentos, avaliações e IA.
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, 
  Brain,
  CheckCircle,
  AlertCircle,
  BarChart3,
  Settings
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAssessmentInstruments } from "@/hooks/assessment/useAssessmentInstruments";
import { ArticleAssessmentTable } from "./ArticleAssessmentTable";
import { AIAssessmentConfigModal } from "./AIAssessmentConfigModal";
import { useAssessmentItems } from "@/hooks/assessment/useAssessmentInstruments";
import { toast } from "sonner";

interface AssessmentInterfaceProps {
  projectId: string;
}

export const AssessmentInterface = ({ projectId }: AssessmentInterfaceProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Ler aba da URL ou usar padrão
  const tabFromUrl = searchParams.get('assessmentTab') as 'dashboard' | 'assessment' | 'ai' | 'configuration' | null;
  const initialTab = (tabFromUrl && ['dashboard', 'assessment', 'ai', 'configuration'].includes(tabFromUrl)) 
    ? tabFromUrl 
    : 'dashboard';
  
  const [activeInstrument, setActiveInstrument] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'assessment' | 'ai' | 'configuration'>(initialTab);
  const [aiConfigModalOpen, setAiConfigModalOpen] = useState(false);
  const [articles, setArticles] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalArticles: 0,
    completedAssessments: 0,
    inProgressAssessments: 0,
    progressPercentage: 0,
  });

  // Hook para gerenciar instrumentos
  const { 
    instruments, 
    loading: instrumentsLoading,
    error: instrumentsError
  } = useAssessmentInstruments();

  const { items: assessmentItems } = useAssessmentItems(activeInstrument?.id || "");

  // Carregar instrumento ativo quando instrumentos são carregados
  useEffect(() => {
    if (instruments.length > 0 && !activeInstrument) {
      const defaultInstrument = instruments[0];
      setActiveInstrument(defaultInstrument);
    }
  }, [instruments]);

  // Sincronizar aba ativa com URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('assessmentTab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // Função para mudar aba e atualizar URL
  const handleTabChange = (tab: 'dashboard' | 'assessment' | 'ai' | 'configuration') => {
    setActiveTab(tab);
  };

  // Carregar artigos e avaliações
  useEffect(() => {
    if (projectId && activeInstrument) {
      loadArticles();
      loadAssessments();
    }
  }, [projectId, activeInstrument]);

  // Calcular estatísticas quando dados mudam
  useEffect(() => {
    if (articles.length > 0 && activeInstrument) {
      calculateStats();
    }
  }, [articles, assessments, activeInstrument]);

  const loadArticles = async () => {
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, doi, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error("Error loading articles:", error);
      toast.error("Erro ao carregar artigos");
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
        .eq("user_id", user.id)
        .eq("is_current_version", true);

      if (error) throw error;
      setAssessments(data || []);
    } catch (error: any) {
      console.error("Error loading assessments:", error);
    }
  };

  const calculateStats = () => {
    const assessmentsForInstrument = assessments.filter(
      a => a.instrument_id === activeInstrument?.id
    );
    
    const completed = assessmentsForInstrument.filter(
      a => a.status === 'submitted' || a.completion_percentage === 100
    ).length;
    
    const inProgress = assessmentsForInstrument.filter(
      a => a.status === 'in_progress' && a.completion_percentage > 0 && a.completion_percentage < 100
    ).length;
    
    const total = articles.length;
    const progressPercentage = total > 0 
      ? Math.round((completed / total) * 100)
      : 0;

    setStats({
      totalArticles: total,
      completedAssessments: completed,
      inProgressAssessments: inProgress,
      progressPercentage,
    });
  };

  // Renderizar aba Dashboard
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Estatísticas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artigos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalArticles}</div>
            <p className="text-xs text-muted-foreground">
              no projeto
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avaliações Completas</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.completedAssessments}
              {stats.inProgressAssessments > 0 && (
                <span className="text-sm text-muted-foreground ml-2">
                  (+{stats.inProgressAssessments})
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              artigos avaliados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Progresso Geral</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.progressPercentage}%</div>
            <p className="text-xs text-muted-foreground">
              completude média
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mensagem se não houver instrumento */}
      {!activeInstrument && !instrumentsLoading && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-900">Nenhum instrumento configurado</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Configure um instrumento de avaliação nas configurações do projeto.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // Renderizar aba IA
  const renderAI = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Avaliação com IA
        </CardTitle>
        <CardDescription>
          Configure e execute avaliações automáticas usando inteligência artificial
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Configure a avaliação com IA</h4>
            <p className="text-sm text-muted-foreground mb-6">
              Selecione artigos e questões para avaliação automática
            </p>
            <Button 
              onClick={() => setAiConfigModalOpen(true)}
              disabled={!activeInstrument || articles.length === 0}
            >
              <Brain className="h-4 w-4 mr-2" />
              Abrir Configuração IA
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // Renderizar conteúdo das abas
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return renderDashboard();
      
      case 'assessment':
        return activeInstrument ? (
          <ArticleAssessmentTable 
            projectId={projectId} 
            instrumentId={activeInstrument.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Nenhum Instrumento Ativo</CardTitle>
              <CardDescription>
                Configure um instrumento de avaliação para começar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Vá para as configurações do projeto para adicionar instrumentos de avaliação.
              </p>
            </CardContent>
          </Card>
        );
      
      case 'ai':
        return renderAI();
      
      case 'configuration':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuração de Instrumentos
              </CardTitle>
              <CardDescription>
                Gerencie instrumentos de avaliação do projeto
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">Funcionalidade em desenvolvimento</h4>
                <p className="text-sm text-muted-foreground">
                  A configuração de instrumentos será implementada em breve
                </p>
              </div>
            </CardContent>
          </Card>
        );
      
      default:
        return renderDashboard();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Avaliação de Qualidade</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Avalie a qualidade metodológica dos artigos usando instrumentos padronizados
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as any)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="assessment" disabled={!activeInstrument}>
            Avaliação
          </TabsTrigger>
          <TabsTrigger value="ai" disabled={!activeInstrument}>
            IA
          </TabsTrigger>
          <TabsTrigger value="configuration" disabled>
            Configuração
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {renderTabContent()}
        </TabsContent>
      </Tabs>

      {/* Loading state */}
      {instrumentsLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando instrumentos...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {instrumentsError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Erro ao carregar instrumentos</p>
                <p className="text-sm">{instrumentsError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal de Configuração de IA */}
      {activeInstrument && (
        <AIAssessmentConfigModal
          open={aiConfigModalOpen}
          onOpenChange={setAiConfigModalOpen}
          projectId={projectId}
          instrumentId={activeInstrument.id}
          articles={articles}
          assessmentItems={assessmentItems}
          onStartBatchProcessing={async () => {
            // Recarregar assessments após processamento
            await loadAssessments();
            setAiConfigModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

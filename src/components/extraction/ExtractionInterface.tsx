/**
 * Interface principal para extração de dados
 * 
 * Componente que gerencia todo o fluxo de extração de dados
 * para um projeto específico, incluindo templates, instâncias e valores.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ClipboardCheck, 
  FileText, 
  Brain, 
  Download,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { ProjectExtractionTemplate } from '@/types/extraction';
import { useExtractionTemplates } from '@/hooks/extraction/useExtractionTemplates';
import { ArticleExtractionTable } from './ArticleExtractionTable';
import { TemplateConfigEditor } from './TemplateConfigEditor';
import { useAuth } from '@/contexts/AuthContext';
import { ImportTemplateDialog } from './dialogs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ExtractionInterfaceProps {
  projectId: string;
}

export function ExtractionInterface({ projectId }: ExtractionInterfaceProps) {
  const { user } = useAuth();
  const [activeTemplate, setActiveTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'extraction' | 'ai' | 'configuration'>('dashboard');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [articles, setArticles] = useState<any[]>([]);
  const [extractionStats, setExtractionStats] = useState({
    totalArticles: 0,
    extractionsStarted: 0,
    extractionsCompleted: 0,
    progressPercentage: 0,
  });

  // Hook para gerenciar templates
  const { 
    templates, 
    loading: templatesLoading, 
    error: templatesError
  } = useExtractionTemplates({ projectId });

  // Carregar template ativo quando templates são carregados
  useEffect(() => {
    if (templates.length > 0 && !activeTemplate) {
      const defaultTemplate = templates.find(t => t.is_active) || templates[0];
      setActiveTemplate(defaultTemplate);
    }
  }, [templates]);

  // Carregar artigos e estatísticas
  useEffect(() => {
    if (projectId) {
      loadArticles();
    }
  }, [projectId]);

  // Carregar estatísticas quando artigos ou template mudam
  useEffect(() => {
    if (articles.length > 0 && activeTemplate && user) {
      loadExtractionStats();
    }
  }, [articles, activeTemplate, user]);


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
    }
  };

  const loadExtractionStats = async () => {
    if (!activeTemplate || !user) return;

    try {
      // Buscar instâncias de extração para o template ativo
      const { data: instances, error: instancesError } = await supabase
        .from("extraction_instances")
        .select("article_id")
        .eq("project_id", projectId)
        .eq("template_id", activeTemplate.id);

      if (instancesError) throw instancesError;

      // Buscar valores extraídos pelo usuário logado
      const { data: extractedValues, error: valuesError } = await supabase
        .from("extracted_values")
        .select(`
          instance_id,
          extraction_instances!inner(article_id, template_id)
        `)
        .eq("extraction_instances.project_id", projectId)
        .eq("extraction_instances.template_id", activeTemplate.id)
        .eq("reviewer_id", user.id);

      if (valuesError) throw valuesError;

      // Calcular estatísticas
      const totalArticles = articles.length;
      const articlesWithInstances = new Set(instances?.map(i => i.article_id) || []);
      const extractionsStarted = articlesWithInstances.size;
      
      // Contar artigos com extração completa (pelo menos uma instância com valores)
      const articlesWithValues = new Set(extractedValues?.map(v => v.extraction_instances.article_id) || []);
      const extractionsCompleted = articlesWithValues.size;
      
      const progressPercentage = totalArticles > 0 
        ? Math.round((extractionsCompleted / totalArticles) * 100)
        : 0;

      setExtractionStats({
        totalArticles,
        extractionsStarted,
        extractionsCompleted,
        progressPercentage,
      });
    } catch (error: any) {
      console.error("Error loading extraction stats:", error);
      toast.error("Erro ao carregar estatísticas de extração");
    }
  };

  // Renderizar aba Dashboard
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Estatísticas Principais - Layout Minimalista */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artigos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{extractionStats.totalArticles}</div>
            <p className="text-xs text-muted-foreground">
              no projeto
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Extrações Iniciadas</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {extractionStats.extractionsStarted}
              {extractionStats.extractionsCompleted > 0 && (
                <span className="text-sm text-muted-foreground ml-2">
                  ({extractionStats.extractionsCompleted} completas)
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              artigos em extração
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Progresso Geral</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{extractionStats.progressPercentage}%</div>
            <p className="text-xs text-muted-foreground">
              completude média
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mensagem se não houver template */}
      {!activeTemplate && !templatesLoading && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-900">Nenhum template configurado</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Um template CHARMS deveria ter sido criado automaticamente. 
                  Se não foi, entre em contato com o suporte.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // Renderizar conteúdo das abas
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return renderDashboard();
      
      case 'extraction':
        return activeTemplate ? (
          <ArticleExtractionTable 
            projectId={projectId} 
            templateId={activeTemplate.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Nenhum Template Ativo</CardTitle>
              <CardDescription>
                Um template CHARMS deveria ter sido criado automaticamente ao criar este projeto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Entre em contato com o suporte se este problema persistir.
              </p>
            </CardContent>
          </Card>
        );
      
      case 'ai':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Sugestões de IA
              </CardTitle>
              <CardDescription>
                Use inteligência artificial para acelerar a extração de dados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">Funcionalidade em desenvolvimento</h4>
                <p className="text-sm text-muted-foreground">
                  As sugestões de IA serão implementadas em breve
                </p>
              </div>
            </CardContent>
          </Card>
        );
      
      case 'configuration':
        return activeTemplate ? (
          <TemplateConfigEditor
            projectId={projectId}
            templateId={activeTemplate.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Nenhum Template Ativo</CardTitle>
                  <CardDescription>
                    Importe um template global para começar a configurar a extração de dados.
                  </CardDescription>
                </div>
                <Button onClick={() => setShowImportDialog(true)}>
                  <Download className="h-4 w-4 mr-2" />
                  Importar Template
                </Button>
              </div>
            </CardHeader>
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
          <h2 className="text-2xl font-semibold">Extração de Dados</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Extraia dados estruturados dos artigos usando templates padronizados
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
          <Badge variant="outline">
            {activeTemplate?.framework || 'Sem Template'}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="extraction" disabled={!activeTemplate}>
            Extração
          </TabsTrigger>
          <TabsTrigger value="ai" disabled={!activeTemplate}>
            IA
          </TabsTrigger>
          <TabsTrigger value="configuration">
            Configuração
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {renderTabContent()}
        </TabsContent>
      </Tabs>

      {/* Loading state */}
      {templatesLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando templates...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {templatesError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Erro ao carregar templates</p>
                <p className="text-sm">{templatesError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog para importar template global */}
      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onTemplateImported={() => {
          // Recarregar página para atualizar templates
          window.location.reload();
        }}
      />
    </div>
  );
}

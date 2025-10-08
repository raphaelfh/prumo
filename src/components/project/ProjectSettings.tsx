/**
 * Configurações do Projeto - Interface Moderna com Tabs
 * 
 * Componente principal de configurações usando layout de tabs
 * para organizar diferentes seções de configuração do projeto.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Info, 
  FileText, 
  Users, 
  Settings as SettingsIcon,
  Save,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Subcomponentes
import { BasicInfoSection } from "./settings/BasicInfoSection";
import { ReviewDetailsSection } from "./settings/ReviewDetailsSection";
import { TeamMembersSection } from "./settings/TeamMembersSection";
import { AdvancedSettingsSection } from "./settings/AdvancedSettingsSection";

type ReviewType = 'interventional' | 'predictive_model' | 'diagnostic' | 'prognostic' | 'qualitative' | 'other';

interface Project {
  id: string;
  name: string;
  description: string | null;
  review_type?: ReviewType | null;
  review_title: string | null;
  condition_studied: string | null;
  review_rationale: string | null;
  search_strategy: string | null;
  picots_config_ai_review: any;
  settings: any;
  eligibility_criteria: any;
  study_design: any;
  review_keywords: any;
  review_context: string | null;
}

interface ProjectSettingsProps {
  projectId: string;
}

type TabId = 'basic' | 'review' | 'team' | 'advanced';

interface Tab {
  id: TabId;
  label: string;
  icon: any;
  description: string;
}

const TABS: Tab[] = [
  {
    id: 'basic',
    label: 'Informações Básicas',
    icon: Info,
    description: 'Nome e descrição do projeto'
  },
  {
    id: 'review',
    label: 'Detalhes da Revisão',
    icon: FileText,
    description: 'PICOTS, estratégia de busca e justificativa'
  },
  {
    id: 'team',
    label: 'Equipe',
    icon: Users,
    description: 'Membros e permissões'
  },
  {
    id: 'advanced',
    label: 'Avançado',
    icon: SettingsIcon,
    description: 'Configurações adicionais'
  }
];

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  const loadProject = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;
      setProject(data);
      setHasUnsavedChanges(false);
    } catch (error: any) {
      console.error("Error loading project:", error);
      toast.error("Erro ao carregar projeto");
    } finally {
      setLoading(false);
    }
  };

  const handleProjectChange = (updates: Partial<Project>) => {
    setProject(prev => prev ? { ...prev, ...updates } : null);
    setHasUnsavedChanges(true);
  };

  const handleSaveChanges = async () => {
    if (!project) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          name: project.name,
          description: project.description,
          review_type: project.review_type,
          review_title: project.review_title,
          condition_studied: project.condition_studied,
          review_rationale: project.review_rationale,
          search_strategy: project.search_strategy,
          picots_config_ai_review: project.picots_config_ai_review,
          settings: project.settings,
          eligibility_criteria: project.eligibility_criteria,
          study_design: project.study_design,
          review_keywords: project.review_keywords,
          review_context: project.review_context,
        })
        .eq("id", projectId);

      if (error) throw error;
      
      toast.success("Alterações salvas com sucesso!");
      setHasUnsavedChanges(false);
      
      // Recarregar para garantir sincronização
      await loadProject();
    } catch (error: any) {
      console.error("Error updating project:", error);
      toast.error("Erro ao salvar alterações");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !project) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Carregando configurações...</p>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic':
        return (
          <BasicInfoSection
            project={project}
            onChange={handleProjectChange}
          />
        );
      case 'review':
        return (
          <ReviewDetailsSection
            project={project}
            onChange={handleProjectChange}
          />
        );
      case 'team':
        return (
          <TeamMembersSection
            projectId={projectId}
          />
        );
      case 'advanced':
        return (
          <AdvancedSettingsSection
            project={project}
            onChange={handleProjectChange}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header com ações - Grudado no topo e wide */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between max-w-[1920px] mx-auto">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Configurações do Projeto
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {TABS.find(t => t.id === activeTab)?.description}
              </p>
            </div>
            
            {hasUnsavedChanges && (
              <Button 
                onClick={handleSaveChanges} 
                disabled={loading}
                size="lg"
              >
                <Save className="mr-2 h-4 w-4" />
                {loading ? "Salvando..." : "Salvar Alterações"}
              </Button>
            )}
          </div>

          {hasUnsavedChanges && (
            <Alert className="mt-4 max-w-[1920px] mx-auto" variant="default">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Você tem alterações não salvas. Clique em "Salvar Alterações" para aplicá-las.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      {/* Layout Principal: Sidebar + Conteúdo - Wide e grudado */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar de Navegação - Grudada na esquerda */}
        <aside className="w-80 border-r bg-muted/20 flex-shrink-0 overflow-y-auto">
          <nav className="py-6 pl-6 pr-4 space-y-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "w-full flex items-start gap-4 px-4 py-3.5 rounded-lg text-left transition-all",
                    "hover:bg-accent/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    isActive 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "text-foreground"
                  )}
                >
                  <Icon className={cn(
                    "h-5 w-5 mt-0.5 flex-shrink-0",
                    isActive ? "text-primary-foreground" : "text-muted-foreground"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "text-sm font-medium leading-tight mb-1.5",
                      isActive && "text-primary-foreground"
                    )}>
                      {tab.label}
                    </div>
                    <div className={cn(
                      "text-xs leading-relaxed line-clamp-2",
                      isActive ? "text-primary-foreground/90" : "text-muted-foreground"
                    )}>
                      {tab.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Área de Conteúdo - Wide com max-width responsivo */}
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="w-full max-w-[1920px] mx-auto">
            <div className="px-8 py-8 lg:px-12 lg:py-10">
              {renderTabContent()}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
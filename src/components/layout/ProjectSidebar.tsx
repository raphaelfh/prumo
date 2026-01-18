/**
 * Sidebar moderno para projetos
 * Substitui as tabs por navegação elegante e funcional
 */

import React, { useState } from 'react';
import { 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Settings,
  Folder,
  ChevronDown,
  Loader2,
  Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useProjectsList } from '@/hooks/useProjectsList';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AddProjectDialog } from '@/components/project/AddProjectDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface ProjectSidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  projectName?: string;
  className?: string;
}


const SIDEBAR_ITEMS = [
  {
    id: 'articles',
    label: 'Artigos',
    icon: FileText,
    description: 'Gerenciar artigos do projeto',
    badge: null,
  },
  {
    id: 'extraction',
    label: 'Extração',
    icon: ClipboardCheck,
    description: 'Extrair dados dos artigos',
    badge: null,
  },
  {
    id: 'assessment',
    label: 'Avaliação',
    icon: BarChart3,
    description: 'Avaliar qualidade dos estudos',
    badge: null,
  },
  {
    id: 'settings',
    label: 'Configurações',
    icon: Settings,
    description: 'Configurar projeto',
    badge: null,
  },
];

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  isCollapsed,
  activeTab,
  onTabChange,
  projectName,
  className,
}) => {
  const { user } = useAuth();
  const { projects, loading, switchProject, loadProjects } = useProjectsList();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateProject = async (data: { name: string; description?: string }) => {
    if (!user?.id) {
      toast.error("Você precisa estar autenticado para criar um projeto");
      return;
    }

    setIsCreating(true);

    try {
      // Usar função RPC que cria projeto e adiciona criador como manager atomicamente
      const { data: projectId, error: rpcError } = await supabase.rpc(
        'create_project_with_member' as any,
        {
          p_name: data.name,
          p_description: data.description || undefined,
          p_review_title: undefined
        }
      );

      if (rpcError) {
        console.error("Error creating project via RPC:", rpcError);
        toast.error(`Erro ao criar projeto: ${rpcError.message}`);
        return;
      }

      if (!projectId || typeof projectId !== 'string') {
        toast.error("Erro: ID do projeto não foi retornado");
        return;
      }

      console.log('✅ Projeto criado com sucesso:', projectId);

      // Feedback para usuário
      toast.success("Projeto criado com sucesso!");

      // Fechar diálogo e recarregar lista de projetos
      setShowAddDialog(false);
      await loadProjects();

      // Navegar para o novo projeto criado
      switchProject(projectId as string);

    } catch (error: any) {
      console.error("Unexpected error:", error);
      toast.error("Erro inesperado ao criar projeto");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <aside 
      className={cn(
        "bg-card border-r transition-all duration-300 ease-in-out",
        "flex flex-col flex-shrink-0 h-full overflow-y-auto",
        isCollapsed ? "w-16" : "w-64",
        "hidden lg:flex",
        className
      )}
    >
      {/* Header do Sidebar */}
      <div className="p-4 border-b">
        {!isCollapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-auto p-2 rounded-lg hover:bg-primary/10 transition-colors group"
              >
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Folder className="h-5 w-5 text-primary transition-colors" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <h2 className="text-sm font-semibold truncate transition-colors">
                    {projectName || 'Projeto'}
                  </h2>
                  <p className="text-xs text-muted-foreground truncate transition-colors">
                    {projectName ? 'Projeto de revisão sistemática' : 'Carregando...'}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {loading ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Carregando projetos...
                  </span>
                </div>
              ) : (
                <>
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => switchProject(project.id)}
                      className="p-0"
                    >
                    <div className="flex items-start gap-2 w-full p-2 group-data-[highlighted]:text-white">
                      <Folder className="h-4 w-4 text-muted-foreground group-data-[highlighted]:text-white mt-0.5 shrink-0 transition-colors" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {project.name}
                        </div>
                        <p className="text-xs text-muted-foreground group-data-[highlighted]:text-white/80 truncate mt-0.5 transition-colors">
                          {project.description || 'Projeto de revisão sistemática'}
                        </p>
                      </div>
                    </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowAddDialog(true)}
                    className="p-0"
                  >
                    <div className="flex items-center gap-2 w-full p-2 group-data-[highlighted]:text-white">
                      <Plus className="h-4 w-4 text-primary group-data-[highlighted]:text-white shrink-0 transition-colors" />
                      <span className="font-medium text-sm text-primary group-data-[highlighted]:text-white transition-colors">
                        Criar Novo Projeto
                      </span>
                    </div>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center justify-center">
            <div className="p-2 rounded-lg bg-primary/10">
              <Folder className="h-5 w-5 text-primary" />
            </div>
          </div>
        )}
      </div>

      {/* Navegação Principal */}
      <nav className="flex-1 p-4 space-y-1">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <Button
              key={item.id}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-3 h-auto p-3 group",
                isCollapsed && "justify-center p-2",
                isActive && "bg-primary/10 text-primary border-primary/20",
                !isActive && "hover:bg-primary hover:text-white"
              )}
              onClick={() => onTabChange(item.id)}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isActive && "text-primary",
                !isActive && "group-hover:text-white"
              )} />
              {!isCollapsed && (
                <>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.label}</span>
                      {item.badge && (
                        <Badge variant="secondary" className="text-xs">
                          {item.badge}
                        </Badge>
                      )}
                    </div>
                    <p className={cn(
                      "text-xs mt-0.5 transition-colors",
                      isActive ? "text-muted-foreground" : "text-muted-foreground group-hover:text-white/80"
                    )}>
                      {item.description}
                    </p>
                  </div>
                </>
              )}
            </Button>
          );
        })}
      </nav>

      {/* Dialog para criar novo projeto */}
      <AddProjectDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onProjectCreate={handleCreateProject}
        isCreating={isCreating}
      />
    </aside>
  );
};

export default ProjectSidebar;

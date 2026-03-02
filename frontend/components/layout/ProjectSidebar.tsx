/**
 * Sidebar moderno para projetos
 * Substitui as tabs por navegação elegante e funcional
 */

import React, {useState} from 'react';
import {BarChart3, ChevronDown, ClipboardCheck, FileText, Home, Loader2, Plus, Settings} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {useProjectsList} from '@/hooks/useProjectsList';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {AddProjectDialog} from '@/components/project/AddProjectDialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useNavigate} from 'react-router-dom';

interface ProjectSidebarProps {
  isCollapsed: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  projectName?: string;
  className?: string;
}


const SIDEBAR_ITEMS = [
    {id: 'articles', label: 'Artigos', icon: FileText},
    {id: 'extraction', label: 'Extração', icon: ClipboardCheck},
    {id: 'assessment', label: 'Avaliação', icon: BarChart3},
    {id: 'settings', label: 'Configurações', icon: Settings},
];

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  isCollapsed,
  activeTab,
  onTabChange,
  projectName,
  className,
}) => {
  const { user } = useAuth();
    const navigate = useNavigate();
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
          "bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40 transition-all duration-300 ease-in-out",
          "flex flex-col flex-shrink-0 h-full",
          isCollapsed ? "w-14" : "w-[240px]",
        "hidden lg:flex",
        className
      )}
    >
          {/* Header do Sidebar */}
        <div className="h-12 flex items-center px-3 border-b border-border/30">
        {!isCollapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-8 px-2 rounded-md hover:bg-muted/50 transition-colors group"
              >
                  <div
                      className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                  <span className="text-[10px] font-semibold text-primary leading-none">
                    {(projectName || 'P')[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1 text-left">
                    <h2 className="text-[13px] font-medium truncate text-foreground/80">
                    {projectName || 'Projeto'}
                  </h2>
                </div>
                  <ChevronDown className="h-3 w-3 text-muted-foreground/50"/>
              </Button>
            </DropdownMenuTrigger>
              <DropdownMenuContent align="start"
                                   className="w-[220px] p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border/50">
              {loading ? (
                <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground"/>
                </div>
              ) : (
                <>
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => switchProject(project.id)}
                      className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
                    >
                        <div
                            className="h-4 w-4 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15 mr-2">
                          <span className="text-[9px] font-semibold text-primary leading-none">
                            {project.name[0].toUpperCase()}
                          </span>
                        </div>
                        <span className="truncate">{project.name}</span>
                    </DropdownMenuItem>
                  ))}
                    <DropdownMenuSeparator className="bg-border/30"/>
                  <DropdownMenuItem
                    onClick={() => setShowAddDialog(true)}
                    className="px-2 py-1.5 rounded-md text-[13px] text-primary focus:bg-primary/5 focus:text-primary"
                  >
                      <Plus className="h-3.5 w-3.5 mr-2"/>
                      <span>Criar Novo Projeto</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
            <div className="flex items-center justify-center w-full">
                <div
                    className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center border border-primary/15">
                  <span className="text-[11px] font-semibold text-primary leading-none">
                    {(projectName || 'P')[0].toUpperCase()}
                  </span>
            </div>
          </div>
        )}
      </div>

          {/* Navegação Principal */}
        <nav className="flex-1 p-2 space-y-0.5">
            {!isCollapsed && (
                <div className="px-2.5 pb-1 pt-2">
              <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider select-none">
                Navegação
              </span>
                </div>
            )}
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <Button
              key={item.id}
              variant="ghost"
              className={cn(
                  "w-full justify-start gap-2.5 h-8 py-0 px-2.5 group relative rounded-md transition-all duration-75",
                  isCollapsed && "justify-center px-0",
                  isActive
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground/80 hover:bg-muted/40 hover:text-foreground"
              )}
              onClick={() => onTabChange(item.id)}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-foreground" : "group-hover:text-foreground/80"
              )} strokeWidth={1.5}/>

              {!isCollapsed && (
                  <span className="text-[13px] transition-colors">
                  {item.label}
                </span>
              )}
            </Button>
          );
        })}
      </nav>

          {/* Footer */}
          <div className="border-t border-border/30 p-2 space-y-0.5">
              <button
                  onClick={() => navigate('/')}
                  className={cn(
                      "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md transition-colors text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      isCollapsed && "justify-center px-0"
                  )}
                  title={isCollapsed ? 'Dashboard' : undefined}
              >
                  <Home className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                  {!isCollapsed && <span className="text-[13px]">Dashboard</span>}
              </button>

              {user && (
                  <div className={cn(
                      "flex items-center gap-2.5 h-8 px-2.5 rounded-md",
                      isCollapsed && "justify-center px-0"
                  )}>
                      <div
                          className="h-5 w-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 border border-border/40">
              <span className="text-[9px] font-medium text-muted-foreground">
                {(user.user_metadata?.full_name || user.email || 'U').charAt(0).toUpperCase()}
              </span>
                      </div>
                      {!isCollapsed && (
                          <span className="text-[12px] text-muted-foreground truncate">
                {user.user_metadata?.full_name || user.email?.split('@')[0]}
              </span>
                      )}
                  </div>
              )}
          </div>

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

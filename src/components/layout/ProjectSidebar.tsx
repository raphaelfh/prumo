/**
 * Sidebar moderno para projetos
 * Substitui as tabs por navegação elegante e funcional
 */

import React from 'react';
import { 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Settings,
  Folder,
  ChevronDown,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useProjectsList } from '@/hooks/useProjectsList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  const { projects, loading, switchProject } = useProjectsList();
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
                className="w-full justify-start gap-2 h-auto p-0 hover:bg-transparent hover:text-foreground"
              >
                <div className="p-2 rounded-lg bg-primary/10">
                  <Folder className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <h2 className="text-sm font-semibold truncate">
                    {projectName || 'Projeto'}
                  </h2>
                  <p className="text-xs text-muted-foreground truncate">
                    {projectName ? 'Projeto de revisão sistemática' : 'Carregando...'}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
                projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => switchProject(project.id)}
                    className="flex flex-col items-start gap-1 p-3"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium truncate flex-1">
                        {project.name}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate w-full ml-6">
                      {project.description || 'Projeto de revisão sistemática'}
                    </p>
                  </DropdownMenuItem>
                ))
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
                "w-full justify-start gap-3 h-auto p-3",
                isCollapsed && "justify-center p-2",
                isActive && "bg-primary/10 text-primary border-primary/20"
              )}
              onClick={() => onTabChange(item.id)}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </>
              )}
            </Button>
          );
        })}
      </nav>
    </aside>
  );
};

export default ProjectSidebar;

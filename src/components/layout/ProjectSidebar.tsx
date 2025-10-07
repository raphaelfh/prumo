/**
 * Sidebar moderno para projetos
 * Substitui as tabs por navegação elegante e funcional
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Settings, 
  ChevronLeft,
  Folder
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
  const navigate = useNavigate();

  const handleBackToDashboard = () => {
    navigate('/');
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
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Folder className="h-5 w-5 text-primary" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold truncate">
                {projectName || 'Projeto'}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {projectName ? 'Projeto de revisão sistemática' : 'Carregando...'}
              </p>
            </div>
          )}
        </div>
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

      {/* Footer do Sidebar */}
      <div className="p-4 border-t">
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start gap-3 h-auto py-3",
            isCollapsed && "justify-center p-3"
          )}
          onClick={handleBackToDashboard}
          title={isCollapsed ? "Voltar ao Dashboard" : undefined}
        >
          <ChevronLeft className="h-4 w-4 flex-shrink-0" />
          {!isCollapsed && (
            <span className="truncate">Voltar ao Dashboard</span>
          )}
        </Button>
      </div>
    </aside>
  );
};

export default ProjectSidebar;

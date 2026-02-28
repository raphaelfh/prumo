/**
 * Sidebar mobile usando Sheet
 * Mesma navegação do desktop adaptada para mobile
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Settings, 
  ChevronLeft,
  Folder,
  ChevronDown,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useProjectsList } from '@/hooks/useProjectsList';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  projectName?: string;
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

export const MobileSidebar: React.FC<MobileSidebarProps> = ({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
  projectName,
}) => {
  const navigate = useNavigate();
  const { projects, loading, switchProject } = useProjectsList();
  const [showProjectsList, setShowProjectsList] = useState(false);

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    onOpenChange(false); // Fechar sidebar após selecionar
  };

  const handleBackToDashboard = () => {
    navigate('/');
    onOpenChange(false);
  };

  const handleProjectSwitch = (projectId: string) => {
    switchProject(projectId);
    setShowProjectsList(false);
    onOpenChange(false);
  };

  return (
    <>
      {/* Sheet principal */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-[280px] p-0">
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-auto p-2 rounded-lg hover:bg-primary/10 transition-colors group"
                onClick={() => setShowProjectsList(true)}
              >
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Folder className="h-5 w-5 text-primary transition-colors" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <SheetTitle className="text-sm font-semibold truncate transition-colors">
                    {projectName || 'Projeto'}
                  </SheetTitle>
                  <p className="text-xs text-muted-foreground truncate transition-colors">
                    {projectName ? 'Projeto de revisão sistemática' : 'Carregando...'}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors" />
              </Button>
            </SheetHeader>

          {/* Navegação */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              
              return (
                <Button
                  key={item.id}
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start gap-3 h-auto p-3 group",
                    isActive && "bg-primary/10 text-primary border-primary/20",
                    !isActive && "hover:bg-primary hover:text-white"
                  )}
                  onClick={() => handleTabChange(item.id)}
                >
                  <Icon className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive && "text-primary",
                    !isActive && "group-hover:text-white"
                  )} />
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
                </Button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={handleBackToDashboard}
            >
              <ChevronLeft className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Voltar ao Dashboard</span>
            </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet para lista de projetos */}
      <Sheet open={showProjectsList} onOpenChange={setShowProjectsList}>
        <SheetContent side="left" className="w-[280px] p-0">
          <div className="flex flex-col h-full">
            <SheetHeader className="p-4 border-b">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowProjectsList(false)}
                  className="p-1 h-auto"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <SheetTitle className="text-sm font-semibold">
                  Projetos
                </SheetTitle>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Carregando projetos...
                  </span>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {projects.map((project) => (
                    <Button
                      key={project.id}
                      variant="ghost"
                      className="w-full justify-start gap-3 h-auto p-3 hover:bg-primary hover:text-white group transition-colors"
                      onClick={() => handleProjectSwitch(project.id)}
                    >
                      <Folder className="h-4 w-4 text-muted-foreground group-hover:text-white transition-colors" />
                      <div className="flex-1 text-left">
                        <div className="font-medium truncate">
                          {project.name}
                        </div>
                        <p className="text-xs text-muted-foreground group-hover:text-white/80 truncate mt-0.5 transition-colors">
                          {project.description || 'Projeto de revisão sistemática'}
                        </p>
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};


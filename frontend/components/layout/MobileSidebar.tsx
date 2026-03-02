/**
 * Sidebar mobile usando Sheet
 * Mesma navegação do desktop adaptada para mobile
 */

import React, {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
    BarChart3,
    ChevronDown,
    ChevronLeft,
    ClipboardCheck,
    FileText,
    Folder,
    Home,
    Loader2,
    Settings
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {cn} from '@/lib/utils';
import {useProjectsList} from '@/hooks/useProjectsList';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  projectName?: string;
}

const SIDEBAR_ITEMS = [
    {id: 'articles', label: 'Artigos', icon: FileText},
    {id: 'extraction', label: 'Extração', icon: ClipboardCheck},
    {id: 'assessment', label: 'Avaliação', icon: BarChart3},
    {id: 'settings', label: 'Configurações', icon: Settings},
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
              <SheetHeader className="px-3 py-3 border-b border-border/30">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2.5 h-9 px-2 rounded-md hover:bg-muted/50 transition-colors"
                onClick={() => setShowProjectsList(true)}
              >
                  <div
                      className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                  <span className="text-[10px] font-semibold text-primary leading-none">
                    {(projectName || 'P')[0].toUpperCase()}
                  </span>
                </div>
                  <SheetTitle className="flex-1 text-left text-[13px] font-medium truncate text-foreground">
                      {projectName || 'Projeto'}
                  </SheetTitle>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0"/>
              </Button>
            </SheetHeader>

          {/* Navegação */}
              <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
                  <div className="px-2.5 pb-1 pt-2">
              <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider select-none">
                Navegação
              </span>
                  </div>
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  className={cn(
                      "w-full justify-start gap-2.5 h-10 px-2.5 rounded-md transition-colors",
                      isActive
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                  onClick={() => handleTabChange(item.id)}
                >
                    <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-foreground" : "")} strokeWidth={1.5}/>
                    <span className="text-[13px]">{item.label}</span>
                </Button>
              );
            })}
          </nav>

          {/* Footer */}
              <div className="border-t border-border/30 p-2">
                  <button
              onClick={handleBackToDashboard}
              className="flex items-center gap-2.5 w-full h-10 px-2.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            >
                      <Home className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                      <span className="text-[13px]">Dashboard</span>
                  </button>
              </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet para lista de projetos */}
      <Sheet open={showProjectsList} onOpenChange={setShowProjectsList}>
        <SheetContent side="left" className="w-[280px] p-0">
          <div className="flex flex-col h-full">
              <SheetHeader className="px-3 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowProjectsList(false)}
                  className="p-1 h-auto"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                  <SheetTitle className="text-[13px] font-semibold">
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
                  <div className="p-2 space-y-0.5">
                  {projects.map((project) => (
                    <Button
                      key={project.id}
                      variant="ghost"
                      className="w-full justify-start gap-2.5 h-10 px-2.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                      onClick={() => handleProjectSwitch(project.id)}
                    >
                        <Folder className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                        <span className="text-[13px] truncate">{project.name}</span>
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

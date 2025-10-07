/**
 * Sidebar mobile usando Sheet
 * Mesma navegação do desktop adaptada para mobile
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Settings, 
  ChevronLeft,
  Folder
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    onOpenChange(false); // Fechar sidebar após selecionar
  };

  const handleBackToDashboard = () => {
    navigate('/');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] p-0">
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="p-4 border-b">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Folder className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <SheetTitle className="text-sm font-semibold truncate">
                  {projectName || 'Projeto'}
                </SheetTitle>
                <p className="text-xs text-muted-foreground truncate">
                  {projectName ? 'Projeto de revisão sistemática' : 'Carregando...'}
                </p>
              </div>
            </div>
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
                    "w-full justify-start gap-3 h-auto p-3",
                    isActive && "bg-primary/10 text-primary border-primary/20"
                  )}
                  onClick={() => handleTabChange(item.id)}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
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
  );
};


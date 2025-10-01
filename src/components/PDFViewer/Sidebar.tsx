import { usePDFStore } from '@/stores/usePDFStore';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, FileText, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnnotationSidebar } from './AnnotationSidebar';
import { PageThumbnails } from './PageThumbnails';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { sidebarCollapsed, sidebarView, toggleSidebar, setSidebarView } = usePDFStore();

  return (
    <div className={cn('relative flex', className)}>
      {/* Sidebar Content */}
      <div
        className={cn(
          'transition-all duration-300 ease-in-out overflow-hidden',
          sidebarCollapsed ? 'w-0' : 'w-64'
        )}
      >
        <div className="w-64 h-full flex flex-col bg-muted/20 border-r">
          {/* Header with Tabs */}
          <div className="p-3 border-b space-y-3">
            <Tabs value={sidebarView} onValueChange={(v) => setSidebarView(v as 'annotations' | 'thumbnails')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="annotations" className="text-xs">
                  <MessageSquare className="h-3 w-3 mr-1" />
                  Anotações
                </TabsTrigger>
                <TabsTrigger value="thumbnails" className="text-xs">
                  <FileText className="h-3 w-3 mr-1" />
                  Páginas
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden h-[calc(100vh-12rem)]">
            {sidebarView === 'annotations' ? (
              <AnnotationSidebar className="w-full border-none h-full" />
            ) : (
              <PageThumbnails className="w-full border-none h-full" />
            )}
          </div>
        </div>
      </div>

      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'absolute top-4 -right-3 h-8 w-6 rounded-full bg-background border shadow-md z-10',
          'hover:bg-accent transition-all duration-300'
        )}
        onClick={toggleSidebar}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

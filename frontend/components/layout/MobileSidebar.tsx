/**
 * Mobile sidebar (Sheet): same sections as desktop, no badges, no resize.
 */
import React from 'react';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {Button} from '@/components/ui/button';
import {SidebarSection} from './SidebarSection';
import {SidebarFooter} from './SidebarFooter';
import {sidebarSections, type SidebarTabId} from './sidebarConfig';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: SidebarTabId) => void;
  projectName?: string;
}

export const MobileSidebar: React.FC<MobileSidebarProps> = ({open, onOpenChange, activeTab, onTabChange, projectName}) => {
  const handleTabChange = (tab: SidebarTabId) => {
    onTabChange(tab);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0">
        <div className="flex flex-col h-full">
          <SheetHeader className="px-3 py-3 pr-12 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                <span className="text-[10px] font-semibold text-primary leading-none">
                  {(projectName || 'P')[0].toUpperCase()}
                </span>
              </div>
              <SheetTitle className="flex-1 text-left text-[13px] font-medium truncate text-foreground">
                {projectName || t('layout', 'defaultProjectName')}
              </SheetTitle>
            </div>
          </SheetHeader>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {sidebarSections.map((section) => (
              <SidebarSection key={section.title} title={section.title}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      onClick={() => handleTabChange(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'w-full justify-start gap-2.5 h-8 px-2.5 rounded-md transition-colors duration-75',
                        active
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 flex-shrink-0', active && 'text-foreground')} strokeWidth={1.5} />
                      <span className="text-[13px]">{item.label}</span>
                    </Button>
                  );
                })}
              </SidebarSection>
            ))}
          </nav>

          <SidebarFooter />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileSidebar;

/**
 * Mobile sidebar (Sheet): the same two states as ProjectSidebar, from the same
 * `deriveSidebarNav`, with no badges and no resize. Navigation writes the URL
 * and closes the drawer.
 *
 * No `h-8` here: the Button scale owns height, and its `sm` tier already
 * carries `[@media(pointer:coarse)]:h-11`, so the drawer gets a 44px touch
 * target on exactly the devices it exists for — better than the fixed 32px it
 * used to hardcode. That override was the file's one entry in
 * `check_button_scale.baseline`, and this rewrite is what lets the baseline
 * shrink (Step 9) rather than hiding the override behind a helper the gate's
 * tag walk cannot see.
 */
import React from 'react';
import {useLocation, useNavigate} from 'react-router';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {Button} from '@/components/ui/button';
import {SidebarSection} from './SidebarSection';
import {SidebarFooter} from './SidebarFooter';
import {BrandMark} from './SidebarBrandHeader';
import {deriveSidebarNav} from './sidebarConfig';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null on `/` and `/settings`: the drawer renders its workspace state. */
  projectId: string | null;
  activeTab: string;
  projectName?: string;
}

export const MobileSidebar: React.FC<MobileSidebarProps> = ({open, onOpenChange, projectId, activeTab, projectName}) => {
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const groups = deriveSidebarNav({projectId, activeTab, pathname});

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0">
        <div className="flex flex-col h-full">
          <SheetHeader className="px-3 py-3 pr-12 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2.5">
              {projectId !== null ? (
                <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                  <span className="text-[10px] font-semibold text-primary leading-none">
                    {(projectName || 'P')[0].toUpperCase()}
                  </span>
                </div>
              ) : (
                <BrandMark />
              )}
              <SheetTitle className="flex-1 text-left text-[13px] font-medium truncate text-foreground">
                {projectId !== null
                  ? projectName || t('layout', 'defaultProjectName')
                  : t('navigation', 'topbarBrandFull')}
              </SheetTitle>
            </div>
          </SheetHeader>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {groups.map((group) => (
              <SidebarSection key={group.title} title={group.title}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      onClick={() => go(item.path)}
                      aria-current={item.active ? 'page' : undefined}
                      className={cn(
                        'w-full justify-start gap-2.5 px-2.5 rounded-md transition-colors duration-75',
                        item.active
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', item.active && 'text-foreground')} strokeWidth={1.5} />
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

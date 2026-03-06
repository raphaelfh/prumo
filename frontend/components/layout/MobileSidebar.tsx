/**
 * Mobile sidebar (Sheet): same sections as desktop (Project, Review) and footer with user menu.
 */

import React, {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {ChevronDown, ChevronLeft, Folder, Home, Loader2, LogOut, Settings} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {cn} from '@/lib/utils';
import {useProjectsList} from '@/hooks/useProjectsList';
import {useAuth} from '@/contexts/AuthContext';
import {useUserProfile} from '@/hooks/useNavigation';
import {t} from '@/lib/copy';
import {sidebarSections} from './sidebarConfig';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  projectName?: string;
}

export const MobileSidebar: React.FC<MobileSidebarProps> = ({
  open,
  onOpenChange,
  activeTab,
  onTabChange,
  projectName,
}) => {
  const navigate = useNavigate();
    const {signOut} = useAuth();
    const {user} = useUserProfile();
  const { projects, loading, switchProject } = useProjectsList();
  const [showProjectsList, setShowProjectsList] = useState(false);

  const handleBackToDashboard = () => {
    navigate('/');
    onOpenChange(false);
  };

    const handleBackToProjects = () => {
        setShowProjectsList(true);
        // Don't close the sheet - just open the project list on top
    };

    const handleSignOut = async () => {
        await signOut();
        navigate('/auth');
        onOpenChange(false);
    };

    const handleTabChange = (tab: string) => {
        onTabChange(tab);
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
          <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0">
          <div className="flex flex-col h-full">
              {/* Header: project selection area with space for close button */}
              <SheetHeader className="px-3 py-3 pr-12 border-b border-border/40 shrink-0">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2.5 h-9 px-2 rounded-md hover:bg-muted/50 transition-colors duration-75"
                onClick={() => setShowProjectsList(true)}
              >
                  <div
                      className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                  <span className="text-[10px] font-semibold text-primary leading-none">
                    {(projectName || 'P')[0].toUpperCase()}
                  </span>
                </div>
                  <SheetTitle className="flex-1 text-left text-[13px] font-medium truncate text-foreground">
                      {projectName || t('layout', 'defaultProjectName')}
                  </SheetTitle>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0"/>
              </Button>
            </SheetHeader>

              {/* Navigation: Project + Review sections */}
              <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
                  {sidebarSections.map((section) => (
                      <div key={section.title}>
                          <div className="px-2.5 pb-1 pt-2">
                  <span
                      className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider select-none">
                    {section.title}
                  </span>
                          </div>
                          {section.items.map((item) => {
                              const Icon = item.icon;
                              const isActive = activeTab === item.id;
                              return (
                                  <Button
                                      key={item.id}
                                      variant="ghost"
                                      className={cn(
                                          "w-full justify-start gap-2.5 h-8 px-2.5 rounded-md transition-colors duration-75",
                                          isActive
                          ? "bg-muted text-foreground font-medium"
                                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                      )}
                                      onClick={() => handleTabChange(item.id)}
                                  >
                                      <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-foreground" : "")}
                                            strokeWidth={1.5}/>
                                      <span className="text-[13px]">{item.label}</span>
                                  </Button>
                              );
                          })}
                      </div>
                  ))}
          </nav>

              {/* Footer: modern layout with back button and user menu */}
              <div className="border-t border-border/40 p-2 space-y-1 shrink-0">
                  <Button
                      variant="secondary"
                      className="w-full justify-start gap-2.5 h-8 px-2.5 rounded-md bg-muted/60 hover:bg-muted text-[13px] font-medium text-foreground border border-border/40 transition-colors duration-75"
                      onClick={handleBackToProjects}
                  >
                      <Folder className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                      {t('layout', 'backToProjects')}
                  </Button>
                  <button
              onClick={handleBackToDashboard}
              className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-75"
            >
                      <Home className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                      <span className="text-[13px]">{t('layout', 'dashboard')}</span>
                  </button>
                  {user && (
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <button
                                  className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-75"
                              >
                                  <Avatar className="h-7 w-7 flex-shrink-0">
                                      <AvatarImage src={user.avatar} alt={user.name}/>
                                      <AvatarFallback className="text-[10px] bg-muted border border-border/40">
                                          {user.initials}
                                      </AvatarFallback>
                                  </Avatar>
                                  <span className="text-[13px] truncate">{user.name}</span>
                                  <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground/50 flex-shrink-0"/>
                              </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="top"
                                               className="w-56 p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border/50">
                              <DropdownMenuLabel className="font-normal px-2 py-1.5">
                                  <p className="text-[13px] font-medium leading-none text-foreground">{user.name}</p>
                                  <p className="text-[12px] leading-none text-muted-foreground mt-0.5">{user.email}</p>
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator/>
                              <DropdownMenuItem onClick={() => {
                                  navigate('/');
                                  onOpenChange(false);
                              }}>
                                  <Folder className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                                  {t('layout', 'backToProjects')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                  navigate('/settings');
                                  onOpenChange(false);
                              }}>
                                  <Settings className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                                  {t('layout', 'settings')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator/>
                              <DropdownMenuItem onClick={handleSignOut}>
                                  <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                                  {t('layout', 'signOut')}
                              </DropdownMenuItem>
                          </DropdownMenuContent>
                      </DropdownMenu>
                  )}
              </div>
          </div>
        </SheetContent>
      </Sheet>

        {/* Sheet for project list */}
      <Sheet open={showProjectsList} onOpenChange={setShowProjectsList}>
        <SheetContent side="left" className="w-[280px] p-0">
          <div className="flex flex-col h-full">
              <SheetHeader className="px-3 py-3 border-b border-border/40">
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
                      {t('layout', 'projects')}
                </SheetTitle>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    {t('layout', 'loadingProjects')}
                  </span>
                </div>
              ) : (
                  <div className="p-2 space-y-0.5">
                  {projects.map((project) => (
                    <Button
                      key={project.id}
                      variant="ghost"
                      className="w-full justify-start gap-2.5 h-8 px-2.5 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-75"
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

/**
 * Project sidebar: two sections (Project, Review) and project switcher.
 */

import React, {useState} from 'react';
import {ChevronDown, Folder, Home, Loader2, LogOut, Plus, Settings} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {cn} from '@/lib/utils';
import {useProjectsList} from '@/hooks/useProjectsList';
import {useAuth} from '@/contexts/AuthContext';
import {useUserProfile} from '@/hooks/useNavigation';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {AddProjectDialog} from '@/components/project/AddProjectDialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useNavigate} from 'react-router-dom';
import {t} from '@/lib/copy';
import {sidebarSections} from './sidebarConfig';

interface ProjectSidebarProps {
  isCollapsed: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  projectName?: string;
  className?: string;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  isCollapsed,
  activeTab,
  onTabChange,
  projectName,
  className,
}) => {
    const {user, signOut} = useAuth();
    const {user: profileUser} = useUserProfile();
    const navigate = useNavigate();
  const { projects, loading, switchProject, loadProjects } = useProjectsList();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

    const handleSignOut = async () => {
        await signOut();
        navigate('/auth');
    };

  const handleCreateProject = async (data: { name: string; description?: string }) => {
    if (!user?.id) {
        toast.error(t('pages', 'dashboardAuthRequired'));
      return;
    }

    setIsCreating(true);

    try {
        // Use RPC that creates project and adds creator as manager atomically
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
          toast.error(`${t('pages', 'dashboardErrorCreating')}: ${rpcError.message}`);
        return;
      }

      if (!projectId || typeof projectId !== 'string') {
          toast.error(t('pages', 'dashboardErrorProjectIdNotReturned'));
        return;
      }

        toast.success(t('pages', 'dashboardProjectCreated'));

        // Close dialog and reload project list
      setShowAddDialog(false);
      await loadProjects();

        // Navigate to the newly created project
      switchProject(projectId as string);

    } catch (error: any) {
      console.error("Unexpected error:", error);
        toast.error(t('pages', 'dashboardUnexpectedError'));
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
          <div className="h-12 flex items-center px-3 border-b border-border/40">
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
                        {projectName || t('layout', 'defaultProjectName')}
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
                      <span>{t('layout', 'createNewProject')}</span>
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

          {/* Main navigation: Project + Review sections */}
          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
              {sidebarSections.map((section) => (
                  <div key={section.title}>
                      {!isCollapsed && (
                <div className="px-2.5 pb-1 pt-2">
                  <span
                      className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider select-none">
                    {section.title}
                  </span>
                </div>
                      )}
                      {section.items.map((item) => {
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
                                          : "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground"
                                  )}
                                  onClick={() => onTabChange(item.id)}
                                  title={isCollapsed ? item.label : undefined}
                              >
                                  <Icon className={cn(
                                      "h-4 w-4 shrink-0 transition-colors",
                                      isActive ? "text-foreground" : "group-hover:text-foreground/80"
                                  )} strokeWidth={1.5}/>
                                  {!isCollapsed && (
                                      <span className="text-[13px] transition-colors">{item.label}</span>
                                  )}
                              </Button>
                          );
                      })}
                  </div>
              ))}
          </nav>

          {/* Footer */}
          <div className="border-t border-border/40 p-2 space-y-0.5">
              <button
                  onClick={() => navigate('/')}
                  className={cn(
                      "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md transition-colors duration-75 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      isCollapsed && "justify-center px-0"
                  )}
                  title={isCollapsed ? t('layout', 'dashboard') : undefined}
              >
                  <Home className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                  {!isCollapsed && <span className="text-[13px]">{t('layout', 'dashboard')}</span>}
              </button>

              {profileUser && (
                  <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                          <button
                              className={cn(
                                  "flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-75",
                                  isCollapsed && "justify-center px-0"
                              )}
                              aria-haspopup="menu"
                          >
                              <Avatar className="h-6 w-6 flex-shrink-0 border border-border/40">
                                  <AvatarImage src={profileUser.avatar} alt={profileUser.name}/>
                                  <AvatarFallback className="text-[9px] bg-muted">
                                      {profileUser.initials}
                                  </AvatarFallback>
                              </Avatar>
                      {!isCollapsed && (
                          <>
                              <span className="text-[13px] truncate flex-1 min-w-0">{profileUser.name}</span>
                              <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground/50 flex-shrink-0"
                                           strokeWidth={1.5}/>
                          </>
                      )}
                          </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="top"
                                           className="w-56 p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border/50">
                          <DropdownMenuLabel className="font-normal px-2 py-1.5">
                              <p className="text-[13px] font-medium leading-none text-foreground">{profileUser.name}</p>
                              <p className="text-[12px] leading-none text-muted-foreground mt-0.5">{profileUser.email}</p>
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-border/30"/>
                          <DropdownMenuItem onClick={() => navigate('/')}
                                            className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
                              <Folder className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                              {t('layout', 'backToProjects')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate('/settings')}
                                            className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
                              <Settings className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                              {t('layout', 'settings')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border/30"/>
                          <DropdownMenuItem onClick={handleSignOut}
                                            className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
                              <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                              {t('layout', 'signOut')}
                          </DropdownMenuItem>
                      </DropdownMenuContent>
                  </DropdownMenu>
              )}
          </div>

          {/* Dialog to create new project */}
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

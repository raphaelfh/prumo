/**
 * Project switcher in the sidebar header.
 * Controlled `open` state allows external triggers (⌘K).
 */
import React, {useState} from 'react';
import {ChevronDown, Folder, Loader2, Plus} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useProjectsList} from '@/hooks/useProjectsList';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';
import {createProject} from '@/services/projectsService';
import {AddProjectDialog} from '@/components/project/AddProjectDialog';
import {t} from '@/lib/copy';

interface SidebarHeaderProps {
  projectName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({projectName, open, onOpenChange}) => {
  const {user} = useAuth();
  const {projects, loading, switchProject, loadProjects} = useProjectsList();
  const navigate = useNavigate();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateProject = async (data: {name: string; description?: string}) => {
    if (!user?.id) {
      toast.error(t('pages', 'dashboardAuthRequired'));
      return;
    }
    setIsCreating(true);
    const result = await createProject(data.name, data.description);
    setIsCreating(false);
    if (!result.ok) {
      toast.error(`${t('pages', 'dashboardErrorCreating')}: ${result.error.message}`);
      return;
    }
    toast.success(t('pages', 'dashboardProjectCreated'));
    setShowAddDialog(false);
    await loadProjects();
    switchProject(result.data.projectId);
  };

  return (
    <div className="h-12 flex items-center px-3 border-b border-border/40">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-keyshortcuts="G P"
            className="w-full justify-start gap-2 h-8 px-2 rounded-md hover:bg-muted/50 transition-colors group"
          >
            <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
              <span className="text-[10px] font-semibold text-primary leading-none">
                {(projectName || 'P')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1 text-left transition-opacity group-data-[peek=closed]/rail:opacity-0">
              <h2 className="text-[13px] font-medium truncate text-foreground/80">
                {projectName || t('layout', 'defaultProjectName')}
              </h2>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground/50 transition-opacity group-data-[peek=closed]/rail:opacity-0" />
            <KbdBadge keys={['G', 'P']} variant="sequence" className="ml-1 transition-opacity group-data-[peek=closed]/rail:opacity-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[260px] p-1 shadow-elev-popover border-border/50">
          {loading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => switchProject(project.id)}
                  className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
                >
                  <div className="h-4 w-4 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15 mr-2">
                    <span className="text-[9px] font-semibold text-primary leading-none">
                      {project.name[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="truncate">{project.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border/30" />
              <DropdownMenuItem
                onClick={() => setShowAddDialog(true)}
                className="px-2 py-1.5 rounded-md text-[13px] text-primary focus:bg-primary/5 focus:text-primary"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                <span>{t('layout', 'createNewProject')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate('/')}
                className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
              >
                <Folder className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                <span>{t('layout', 'backToProjects')}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AddProjectDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onProjectCreate={handleCreateProject}
        isCreating={isCreating}
      />
    </div>
  );
};

export default SidebarHeader;

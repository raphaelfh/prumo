/**
 * One hub row.
 *
 * A stretched link (`after:absolute after:inset-0`) makes the whole row
 * clickable while keeping exactly one link and one button in the a11y tree —
 * the old `role="button"` div with a nested control could not have carried the
 * `⋯` menu. The row's accessible name is the project name and nothing else:
 * the `is_active` fragment that used to be appended to it encoded a column
 * nothing writes (spec §5).
 */
import React from 'react';
import {Link} from 'react-router';
import {Archive, ArchiveRestore, BookOpen, MoreHorizontal} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {HeaderIconButton} from '@/components/layout/HeaderIconButton';
import {relativeTime} from '@/lib/relative-time';
import {isProjectManager, type ProjectListItem} from '@/types/project';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ProjectRowProps {
  project: ProjectListItem;
  /** The caller, so the manager check reads the caller's own membership row. */
  userId: string;
  onArchivedChange: (projectId: string, archived: boolean) => void;
}

export const ProjectRow: React.FC<ProjectRowProps> = ({project, userId, onArchivedChange}) => {
  const canManage = isProjectManager(project, userId);
  const subtitle = project.description || project.review_title || '';

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3 lg:px-6',
        'transition-colors duration-75 motion-reduce:transition-none',
        'hover:bg-muted/40 focus-within:bg-muted/40',
        !project.is_active && 'opacity-60',
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/20 transition-all duration-150 group-hover:border-border group-hover:shadow-xs motion-reduce:transition-none">
        <BookOpen
          className="h-4 w-4 text-muted-foreground/60 transition-colors group-hover:text-foreground motion-reduce:transition-none"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <Link
            to={`/projects/${project.id}`}
            className="truncate rounded text-[14px] font-medium tracking-tight text-foreground transition-colors after:absolute after:inset-0 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
          >
            {project.name}
          </Link>
          {!project.is_active && (
            <span className="shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('pages', 'dashboardArchivedBadge')}
            </span>
          )}
        </div>
        <p className="truncate text-[12px] font-normal leading-relaxed text-muted-foreground/60">
          {subtitle}
        </p>
      </div>

      <div className="hidden shrink-0 flex-col items-end pl-2 md:flex">
        <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          {t('pages', 'dashboardUpdatedPrefix')}
        </span>
        <span className="text-[12px] font-medium text-muted-foreground/80">
          {relativeTime(project.updated_at)}
        </span>
      </div>

      {canManage && (
        <div className="relative z-10 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderIconButton
                aria-label={t('pages', 'dashboardRowActionsAria')}
                className="opacity-0 transition-opacity duration-75 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none"
              >
                <MoreHorizontal strokeWidth={1.5} aria-hidden="true" />
              </HeaderIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {project.is_active ? (
                <DropdownMenuItem onSelect={() => onArchivedChange(project.id, true)}>
                  <Archive className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {t('pages', 'dashboardArchive')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onArchivedChange(project.id, false)}>
                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {t('pages', 'dashboardRestore')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
};

/**
 * Notification Center - Notifications in the Topbar
 *
 * Minimal professional component to show notifications for:
 * - Background jobs (Zotero imports, etc)
 * - System alerts
 * - Important updates
 */

import {useEffect, useMemo, useState} from 'react';
import {Bell, CheckCircle2, Clock, Loader2, X, XCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Progress} from '@/components/ui/progress';
import {useBackgroundJobs} from '@/stores/useBackgroundJobs';
import {useBackgroundJobPolling} from '@/hooks/useBackgroundJobPolling';
import {cn} from '@/lib/utils';
import {toast} from 'sonner';
import {useNavigate} from 'react-router-dom';
import type {ArticlesExportJob, BackgroundJob, ZoteroImportJob} from '@/types/background-jobs';
import {t} from '@/lib/copy';
import {getExportStatus} from '@/services/articlesExportService';

export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
    const {jobs, removeJob, clearCompletedJobs, getRecentJobs, updateJob} = useBackgroundJobs();
  
  const recentJobs = useMemo(() => getRecentJobs(20), [jobs, getRecentJobs]);

    useEffect(() => {
        let isInFlight = false;
        let isDisposed = false;

        const tick = async () => {
            if (isInFlight || isDisposed) return;
            isInFlight = true;
            try {
                const exportJobs = useBackgroundJobs
                    .getState()
                    .jobs.filter(
                        (job) =>
                            job.type === 'articles-export' &&
                            (job.status === 'pending' || job.status === 'running')
                    ) as ArticlesExportJob[];

                if (exportJobs.length === 0) return;

                await Promise.all(
                    exportJobs.map(async (job) => {
                        try {
                            const status = await getExportStatus(job.metadata.backendJobId);
                            const nextStatus = status.status === 'pending' ? 'running' : status.status;
                            updateJob(job.id, {
                                status: nextStatus,
                                startedAt: job.startedAt ?? Date.now(),
                                completedAt:
                                    status.status === 'completed' ||
                                    status.status === 'failed' ||
                                    status.status === 'cancelled'
                                        ? Date.now()
                                        : undefined,
                                error: status.error,
                                progress: status.progress
                                    ? {
                                        phase: status.progress.stage,
                                        current: status.progress.current,
                                        total: status.progress.total,
                                        message: status.progress.stage,
                                    }
                                    : undefined,
                                metadata: {
                                    ...job.metadata,
                                    downloadUrl: status.downloadUrl ?? job.metadata.downloadUrl,
                                },
                                stats:
                                    status.skippedFiles && status.skippedFiles.length > 0
                                        ? {skipped: status.skippedFiles.length}
                                        : undefined,
                            });
                        } catch (error) {
                            updateJob(job.id, {
                                status: 'failed',
                                completedAt: Date.now(),
                                error: error instanceof Error ? error.message : 'Failed to check export status',
                            });
                        }
                    })
                );
            } finally {
                isInFlight = false;
            }
        };

        void tick();
        const id = setInterval(() => {
            void tick();
        }, 2500);
        return () => {
            isDisposed = true;
            clearInterval(id);
        };
    }, [updateJob]);

    // Polling to update jobs
  useBackgroundJobPolling({
    interval: 2000,
    onJobComplete: (job) => {
      toast.success(getCompletionMessage(job), {
        duration: 5000,
          action:
              job.type === 'zotero-import'
                  ? {
                      label: t('navigation', 'viewProject'),
                      onClick: () => {
                          const zoteroJob = job as ZoteroImportJob;
                          navigate(`/projects/${zoteroJob.metadata.projectId}`);
                      },
                  }
                  : job.type === 'articles-export'
                      ? {
                          label: t('articles', 'exportDownload'),
                          onClick: () => {
                              const exportJob = job as ArticlesExportJob;
                              if (exportJob.metadata.downloadUrl) {
                                  window.open(exportJob.metadata.downloadUrl, '_blank', 'noopener,noreferrer');
                              }
                          },
                      }
                      : undefined,
      });
    },
    onJobFailed: (job) => {
        toast.error(`${t('navigation', 'errorPrefix')}: ${job.error || t('navigation', 'operationFailed')}`, {
        duration: 7000,
      });
    },
  });

    // Count unread notifications (jobs that finished recently)
  const unreadCount = useMemo(() => {
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    return recentJobs.filter((job) => {
      if (job.status !== 'completed' && job.status !== 'failed') {
        return false;
      }
      const completedTime = job.completedAt || 0;
      return now - completedTime < FIVE_MINUTES;
    }).length;
  }, [recentJobs]);

  const handleRemoveJob = (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeJob(jobId);
  };

  const handleClearAll = () => {
    clearCompletedJobs();
      toast.info(t('navigation', 'notificationsCleared'));
  };

  const handleJobClick = (job: BackgroundJob) => {
    if (job.type === 'zotero-import' && job.status === 'completed') {
      const zoteroJob = job as ZoteroImportJob;
      navigate(`/projects/${zoteroJob.metadata.projectId}`);
      setOpen(false);
        return;
    }
      if (job.type === 'articles-export' && job.status === 'completed') {
          const exportJob = job as ArticlesExportJob;
          if (exportJob.metadata.downloadUrl) {
              window.open(exportJob.metadata.downloadUrl, '_blank', 'noopener,noreferrer');
          }
          setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-75"
          aria-label={t('navigation', 'notifications')}
        >
            <Bell className="h-4 w-4" strokeWidth={1.5}/>
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-[400px]">
        <DropdownMenuLabel className="flex items-center justify-between">
            <span>{t('navigation', 'notifications')}</span>
          {recentJobs.some(j => j.status === 'completed' || j.status === 'failed') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="h-6 px-2 text-xs"
            >
                {t('navigation', 'clear')}
            </Button>
          )}
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        <ScrollArea className="max-h-[500px]">
          {recentJobs.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t('navigation', 'noNotifications')}</p>
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {recentJobs.map((job) => (
                <NotificationItem
                  key={job.id}
                  job={job}
                  onRemove={handleRemoveJob}
                  onClick={handleJobClick}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =================== ITEM COMPONENT ===================

interface NotificationItemProps {
  job: BackgroundJob;
  onRemove: (jobId: string, e: React.MouseEvent) => void;
  onClick: (job: BackgroundJob) => void;
}

function NotificationItem({ job, onRemove, onClick }: NotificationItemProps) {
  const icon = getJobIcon(job);
    const isClickable =
        job.status === 'completed' && (job.type === 'zotero-import' || job.type === 'articles-export');

  return (
    <div
      className={cn(
        'group relative p-3 rounded-lg border transition-colors',
        isClickable && 'cursor-pointer hover:bg-accent',
        !isClickable && 'bg-background'
      )}
      onClick={() => isClickable && onClick(job)}
    >
      <div className="flex items-start gap-3">
          {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {icon}
        </div>

          {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-tight">
              {getJobTitle(job)}
            </p>
            
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onClick={(e) => onRemove(job.id, e)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2">
            {getJobDescription(job)}
          </p>

          {/* Progresso (se running) */}
          {job.status === 'running' && job.progress && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate flex-1">
                  {job.progress.message}
                </span>
                <span className="text-muted-foreground ml-2 flex-shrink-0">
                  {job.progress.current}/{job.progress.total}
                </span>
              </div>
              <Progress 
                value={(job.progress.current / Math.max(job.progress.total, 1)) * 100} 
                className="h-1"
              />
            </div>
          )}

          {/* Stats (se completed) */}
          {job.status === 'completed' && job.stats && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
              {job.stats.imported !== undefined && job.stats.imported > 0 && (
                <span>✓ {job.stats.imported} importados</span>
              )}
              {job.stats.updated !== undefined && job.stats.updated > 0 && (
                <span>↻ {job.stats.updated} atualizados</span>
              )}
              {job.stats.pdfsDownloaded !== undefined && job.stats.pdfsDownloaded > 0 && (
                <span>📄 {job.stats.pdfsDownloaded} PDFs</span>
              )}
            </div>
          )}

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground/70">
            {getJobTimestamp(job)}
          </p>
        </div>
      </div>
    </div>
  );
}

// =================== HELPERS ===================

function getJobIcon(job: BackgroundJob) {
  switch (job.status) {
    case 'running':
    case 'pending':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-orange-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function getJobTitle(job: BackgroundJob): string {
  if (job.type === 'zotero-import') {
      return t('navigation', 'zoteroImport');
  }
    if (job.type === 'articles-export') {
        return t('articles', 'exportTitle');
    }
    return t('navigation', 'backgroundTask');
}

function getJobDescription(job: BackgroundJob): string {
  if (job.type === 'zotero-import') {
    const metadata = (job as ZoteroImportJob).metadata;
    const collectionName = metadata.collectionName || 'Collection';
      const projectName = metadata.projectName || t('navigation', 'defaultProjectName');

    if (job.status === 'running' || job.status === 'pending') {
        return `${t('navigation', 'importingTo')} "${collectionName}" → "${projectName}"`;
    } else if (job.status === 'completed') {
        return `"${collectionName}" ${t('navigation', 'importedSuccess')}`;
    } else if (job.status === 'failed') {
        return job.error || t('navigation', 'importError');
    }
  }
    if (job.type === 'articles-export') {
        const metadata = (job as ArticlesExportJob).metadata;
        const formats = metadata.formats.join(', ').toUpperCase();
        if (job.status === 'running' || job.status === 'pending') {
            return `${t('articles', 'exportInProgress')} (${metadata.articleCount} items, ${formats})`;
        }
        if (job.status === 'completed') {
            const skipped = job.stats?.skipped ?? 0;
            return skipped > 0
                ? t('articles', 'exportSkippedFilesCount').replace('{{n}}', String(skipped))
                : t('articles', 'exportDownloadReady');
        }
        if (job.status === 'failed') {
            return job.error || t('articles', 'exportFailed');
        }
        if (job.status === 'cancelled') {
            return t('articles', 'exportCancelled');
        }
    }

    return job.status === 'completed' ? t('navigation', 'statusCompleted') : job.error || t('navigation', 'statusInProgress');
}

function getCompletionMessage(job: BackgroundJob): string {
  if (job.type === 'zotero-import') {
    const stats = job.stats || {};
    const parts: string[] = [];

      if (stats.imported) parts.push(`${stats.imported} ${t('navigation', 'importedCount')}`);
      if (stats.updated) parts.push(`${stats.updated} ${t('navigation', 'updatedCount')}`);
    if (stats.pdfsDownloaded) parts.push(`${stats.pdfsDownloaded} PDFs`);

      return `${t('navigation', 'importComplete')} ${parts.join(', ')}`;
  }
    if (job.type === 'articles-export') {
        return t('articles', 'exportDownloadReady');
    }

    return t('navigation', 'taskCompleteSuccess');
}

function getJobTimestamp(job: BackgroundJob): string {
  const timestamp = job.completedAt || job.startedAt || job.createdAt;
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${t('navigation', 'timeAgo')}`;
    if (hours > 0) return `${hours}h ${t('navigation', 'timeAgo')}`;
    if (minutes > 0) return `${minutes}min ${t('navigation', 'timeAgo')}`;
    if (seconds > 5) return `${seconds}s ${t('navigation', 'timeAgo')}`;
    return t('navigation', 'timeNow');
}


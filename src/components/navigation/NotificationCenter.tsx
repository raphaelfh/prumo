/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Notification Center - Centro de Notificações no Topbar
 * 
 * Componente minimalista e profissional para exibir notificações de:
 * - Background jobs (importações Zotero, etc)
 * - Alertas do sistema
 * - Updates importantes
 */

import { useState, useMemo } from 'react';
import { Bell, CheckCircle2, XCircle, Clock, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useBackgroundJobs } from '@/stores/useBackgroundJobs';
import { useBackgroundJobPolling } from '@/hooks/useBackgroundJobPolling';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import type { BackgroundJob, ZoteroImportJob } from '@/types/background-jobs';

export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { jobs, removeJob, clearCompletedJobs, getRecentJobs } = useBackgroundJobs();
  
  const recentJobs = useMemo(() => getRecentJobs(20), [jobs, getRecentJobs]);
  
  // Polling para atualizar jobs
  useBackgroundJobPolling({
    interval: 2000,
    onJobComplete: (job) => {
      toast.success(getCompletionMessage(job), {
        duration: 5000,
        action: job.type === 'zotero-import' ? {
          label: 'Ver Projeto',
          onClick: () => {
            const zoteroJob = job as ZoteroImportJob;
            navigate(`/projects/${zoteroJob.metadata.projectId}`);
          },
        } : undefined,
      });
    },
    onJobFailed: (job) => {
      toast.error(`Erro: ${job.error || 'Falha na operação'}`, {
        duration: 7000,
      });
    },
  });

  // Contar notificações não lidas (jobs que finalizaram recentemente)
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
    toast.info('Notificações limpas');
  };

  const handleJobClick = (job: BackgroundJob) => {
    if (job.type === 'zotero-import' && job.status === 'completed') {
      const zoteroJob = job as ZoteroImportJob;
      navigate(`/projects/${zoteroJob.metadata.projectId}`);
      setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
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
          <span>Notificações</span>
          {recentJobs.some(j => j.status === 'completed' || j.status === 'failed') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="h-6 px-2 text-xs"
            >
              Limpar
            </Button>
          )}
        </DropdownMenuLabel>
        
        <DropdownMenuSeparator />
        
        <ScrollArea className="max-h-[500px]">
          {recentJobs.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Nenhuma notificação</p>
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

// =================== COMPONENTE ITEM ===================

interface NotificationItemProps {
  job: BackgroundJob;
  onRemove: (jobId: string, e: React.MouseEvent) => void;
  onClick: (job: BackgroundJob) => void;
}

function NotificationItem({ job, onRemove, onClick }: NotificationItemProps) {
  const icon = getJobIcon(job);
  const isClickable = job.status === 'completed' && job.type === 'zotero-import';

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
        {/* Ícone */}
        <div className="flex-shrink-0 mt-0.5">
          {icon}
        </div>

        {/* Conteúdo */}
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
    return `Importação do Zotero`;
  }
  return 'Tarefa em background';
}

function getJobDescription(job: BackgroundJob): string {
  if (job.type === 'zotero-import') {
    const metadata = (job as ZoteroImportJob).metadata;
    const collectionName = metadata.collectionName || 'Collection';
    const projectName = metadata.projectName || 'Projeto';
    
    if (job.status === 'running' || job.status === 'pending') {
      return `Importando "${collectionName}" para "${projectName}"`;
    } else if (job.status === 'completed') {
      return `"${collectionName}" importada com sucesso`;
    } else if (job.status === 'failed') {
      return job.error || 'Erro ao importar collection';
    }
  }
  
  return job.status === 'completed' ? 'Concluída' : job.error || 'Em andamento';
}

function getCompletionMessage(job: BackgroundJob): string {
  if (job.type === 'zotero-import') {
    const stats = job.stats || {};
    const parts: string[] = [];
    
    if (stats.imported) parts.push(`${stats.imported} importados`);
    if (stats.updated) parts.push(`${stats.updated} atualizados`);
    if (stats.pdfsDownloaded) parts.push(`${stats.pdfsDownloaded} PDFs`);
    
    return `Importação concluída! ${parts.join(', ')}`;
  }
  
  return 'Tarefa concluída com sucesso!';
}

function getJobTimestamp(job: BackgroundJob): string {
  const timestamp = job.completedAt || job.startedAt || job.createdAt;
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `há ${days}d`;
  if (hours > 0) return `há ${hours}h`;
  if (minutes > 0) return `há ${minutes}min`;
  if (seconds > 5) return `há ${seconds}s`;
  return 'agora';
}


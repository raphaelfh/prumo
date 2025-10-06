/**
 * FileUploadProgress Component
 * 
 * Componente para mostrar progresso de upload de múltiplos arquivos com:
 * - Progress bar individual por arquivo
 * - Estados visuais (uploading, success, error)
 * - Estatísticas gerais
 * - Cancelamento de uploads
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Loader2, FileIcon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface FileUploadProgressItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  uploadedSize?: number;
  totalSize?: number;
  speed?: number; // bytes por segundo
}

export interface FileUploadProgressProps {
  /**
   * Lista de arquivos em upload
   */
  items: FileUploadProgressItem[];
  
  /**
   * Callback para cancelar upload individual
   */
  onCancel?: (itemId: string) => void;
  
  /**
   * Callback para tentar novamente
   */
  onRetry?: (itemId: string) => void;
  
  /**
   * Mostrar estatísticas gerais
   */
  showStats?: boolean;
  
  /**
   * Classe CSS customizada
   */
  className?: string;
}

export const FileUploadProgress: React.FC<FileUploadProgressProps> = ({
  items,
  onCancel,
  onRetry,
  showStats = true,
  className
}) => {
  // Calcular estatísticas gerais
  const stats = React.useMemo(() => {
    const total = items.length;
    const completed = items.filter(i => i.status === 'success').length;
    const failed = items.filter(i => i.status === 'error').length;
    const uploading = items.filter(i => i.status === 'uploading').length;
    const pending = items.filter(i => i.status === 'pending').length;
    
    const totalProgress = items.reduce((acc, item) => acc + item.progress, 0) / (total || 1);
    
    const totalSize = items.reduce((acc, item) => acc + item.file.size, 0);
    const uploadedSize = items.reduce((acc, item) => {
      return acc + (item.uploadedSize || (item.file.size * item.progress / 100));
    }, 0);
    
    const avgSpeed = items
      .filter(i => i.speed && i.speed > 0)
      .reduce((acc, item) => acc + (item.speed || 0), 0) / (uploading || 1);
    
    return {
      total,
      completed,
      failed,
      uploading,
      pending,
      totalProgress,
      totalSize,
      uploadedSize,
      avgSpeed
    };
  }, [items]);

  // Formatar bytes
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  // Formatar velocidade
  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  // Estimar tempo restante
  const estimateTimeRemaining = (uploadedSize: number, totalSize: number, speed: number): string => {
    if (speed === 0) return '---';
    const remainingBytes = totalSize - uploadedSize;
    const secondsRemaining = remainingBytes / speed;
    
    if (secondsRemaining < 60) return `${Math.ceil(secondsRemaining)}s`;
    if (secondsRemaining < 3600) return `${Math.ceil(secondsRemaining / 60)}min`;
    return `${Math.ceil(secondsRemaining / 3600)}h`;
  };

  if (items.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Upload de Arquivos</CardTitle>
        {showStats && (
          <CardDescription>
            {stats.completed} de {stats.total} concluídos
            {stats.failed > 0 && ` • ${stats.failed} falharam`}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progresso geral */}
        {showStats && stats.uploading > 0 && (
          <div className="space-y-2 pb-4 border-b">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progresso Geral</span>
              <span className="font-medium">{Math.round(stats.totalProgress)}%</span>
            </div>
            <Progress value={stats.totalProgress} className="h-2" />
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatBytes(stats.uploadedSize)} de {formatBytes(stats.totalSize)}</span>
              {stats.avgSpeed > 0 && (
                <span>
                  {formatSpeed(stats.avgSpeed)} • {estimateTimeRemaining(stats.uploadedSize, stats.totalSize, stats.avgSpeed)} restantes
                </span>
              )}
            </div>
          </div>
        )}

        {/* Lista de arquivos */}
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {items.map((item) => (
            <FileUploadItem
              key={item.id}
              item={item}
              onCancel={onCancel}
              onRetry={onRetry}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Item individual de progresso
 */
interface FileUploadItemProps {
  item: FileUploadProgressItem;
  onCancel?: (itemId: string) => void;
  onRetry?: (itemId: string) => void;
}

const FileUploadItem: React.FC<FileUploadItemProps> = ({ item, onCancel, onRetry }) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  // Ícone baseado no status
  const StatusIcon = () => {
    switch (item.status) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />;
      case 'uploading':
        return <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />;
      default:
        return <FileIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />;
    }
  };

  return (
    <div className={cn(
      "flex items-start gap-3 p-3 rounded-lg border transition-colors",
      item.status === 'success' && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900",
      item.status === 'error' && "bg-destructive/10 border-destructive/20"
    )}>
      {/* Status icon */}
      <StatusIcon />

      {/* Informações do arquivo */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(item.file.size)}
            </p>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1">
            {item.status === 'uploading' && onCancel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCancel(item.id)}
                className="h-7 text-xs"
              >
                Cancelar
              </Button>
            )}
            {item.status === 'error' && onRetry && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRetry(item.id)}
                className="h-7 text-xs"
              >
                Tentar novamente
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar para uploads em andamento */}
        {(item.status === 'uploading' || item.status === 'pending') && (
          <div className="space-y-1">
            <Progress value={item.progress} className="h-1.5" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{Math.round(item.progress)}%</span>
              {item.speed && item.speed > 0 && (
                <span>{formatBytes(item.speed)}/s</span>
              )}
            </div>
          </div>
        )}

        {/* Mensagem de erro */}
        {item.status === 'error' && item.error && (
          <p className="text-xs text-destructive">{item.error}</p>
        )}

        {/* Mensagem de sucesso */}
        {item.status === 'success' && (
          <p className="text-xs text-green-600 dark:text-green-400">Upload concluído com sucesso</p>
        )}
      </div>
    </div>
  );
};


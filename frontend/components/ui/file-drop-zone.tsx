/**
 * FileDropZone Component
 *
 * Reusable drag & drop file component with:
 * - Multiple file support
 * - Visual preview
 * - Customizable validation
 * - Visual states (hover, dragging, error)
 * - Accessibility (keyboard navigation)
 */

import React, {useCallback, useRef, useState} from 'react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {AlertCircle, File, FileIcon, Upload, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Alert, AlertDescription} from '@/components/ui/alert';

export interface FileWithPreview extends File {
  preview?: string;
  id?: string;
}

export interface FileDropZoneProps {
  /**
   * Callback when files are selected
   */
  onFilesSelected: (files: FileWithPreview[]) => void;
  
  /**
   * Currently selected files
   */
  selectedFiles?: FileWithPreview[];
  
  /**
   * Callback to remove file
   */
  onFileRemove?: (fileId: string) => void;
  
  /**
   * Maximum number of files
   */
  maxFiles?: number;
  
  /**
   * Maximum size per file (bytes)
   */
  maxFileSize?: number;
  
  /**
   * Accepted MIME types
   */
  acceptedTypes?: string[];
  
  /**
   * Accepted extensions (e.g. ['.pdf', '.doc'])
   */
  acceptedExtensions?: string[];
  
  /**
   * Custom label/description
   */
  label?: string;
  description?: string;
  
  /**
   * Loading state
   */
  isUploading?: boolean;
  
  /**
   * Disable dropzone
   */
  disabled?: boolean;
  
  /**
   * Custom CSS class
   */
  className?: string;
  
  /**
   * Show file previews
   */
  showPreview?: boolean;
  
  /**
   * Error callback
   */
  onError?: (error: string) => void;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFilesSelected,
  selectedFiles = [],
  onFileRemove,
  maxFiles = 10,
  maxFileSize = 50 * 1024 * 1024, // 50MB
  acceptedTypes = [],
  acceptedExtensions = [],
                                                              label,
                                                              description,
  isUploading = false,
  disabled = false,
  className,
  showPreview = true,
  onError
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  /**
   * Valida um arquivo individual
   */
  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    // Validar tamanho
    if (file.size > maxFileSize) {
      return {
        valid: false,
          error: t('ui', 'fileSizeExceedsMax').replace('{{name}}', file.name).replace('{{size}}', (maxFileSize / 1024 / 1024).toFixed(0))
      };
    }

    // Validar tipo MIME
    if (acceptedTypes.length > 0 && !acceptedTypes.includes(file.type)) {
        // Check extension as fallback
      const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
      if (acceptedExtensions.length > 0 && !acceptedExtensions.includes(extension)) {
        return {
          valid: false,
            error: t('ui', 'fileTypeNotAccepted').replace('{{name}}', file.name)
        };
      }
    }

    return { valid: true };
  }, [maxFileSize, acceptedTypes, acceptedExtensions]);

  /**
   * Processa arquivos selecionados
   */
  const processFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;

    const files = Array.from(fileList);

      // Validate max number of files
    if (selectedFiles.length + files.length > maxFiles) {
        const errorMsg = t('ui', 'maxFilesReached').replace('{{count}}', String(maxFiles));
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    // Validar cada arquivo
    const validFiles: FileWithPreview[] = [];
    const errors: string[] = [];

    files.forEach(file => {
      const validation = validateFile(file);
      if (validation.valid) {
          // Generate unique ID and preview if image
        const fileWithMetadata: FileWithPreview = Object.assign(file, {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        });
        validFiles.push(fileWithMetadata);
      } else if (validation.error) {
        errors.push(validation.error);
      }
    });

    // Mostrar erros se houver
    if (errors.length > 0) {
      const errorMsg = errors.join(', ');
      setError(errorMsg);
      onError?.(errorMsg);
    } else {
      setError(null);
    }

      // Notify valid files
    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }
  }, [selectedFiles.length, maxFiles, validateFile, onFilesSelected, onError]);

  /**
   * Handler para drag events
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isUploading) {
      setIsDragging(true);
    }
  }, [disabled, isUploading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

      // Only clear state if actually left the dropzone
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled || isUploading) return;

    const { files } = e.dataTransfer;
    processFiles(files);
  }, [disabled, isUploading, processFiles]);

  /**
   * Handler for click selection
   */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    // Limpar input para permitir selecionar o mesmo arquivo novamente
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [processFiles]);

  /**
   * Handler para remover arquivo
   */
  const handleRemoveFile = useCallback((fileId: string) => {
    const file = selectedFiles.find(f => f.id === fileId);
    if (file?.preview) {
      URL.revokeObjectURL(file.preview);
    }
    onFileRemove?.(fileId);
  }, [selectedFiles, onFileRemove]);

  /**
   * Limpar previews ao desmontar
   */
  React.useEffect(() => {
    return () => {
      selectedFiles.forEach(file => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
  }, [selectedFiles]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
        className={cn(
          "relative border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
          "hover:border-primary/50 hover:bg-accent/5",
          isDragging && "border-primary bg-primary/5 scale-[1.02]",
          (disabled || isUploading) && "opacity-50 cursor-not-allowed",
          error && "border-destructive"
        )}
        role="button"
        tabIndex={disabled || isUploading ? -1 : 0}
        aria-label={t('ui', 'uploadAreaAria')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        {/* Input oculto */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.length > 0 ? acceptedTypes.join(',') : undefined}
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled || isUploading}
          aria-hidden="true"
        />

        {/* Ícone e texto */}
        <div className="flex flex-col items-center gap-3">
          <div className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
            isDragging ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}>
            <Upload className="w-8 h-8" />
          </div>

          <div>
              <p className="text-lg font-medium mb-1">{label ?? t('ui', 'fileDropLabel')}</p>
              <p className="text-sm text-muted-foreground">{description ?? t('ui', 'fileDropDescription')}</p>
          </div>

            {/* Info about limits */}
          <div className="text-xs text-muted-foreground space-y-1">
              <p>{t('ui', 'fileDropMaxFiles').replace('{{n}}', String(maxFiles)).replace('{{size}}', (maxFileSize / 1024 / 1024).toFixed(0))}</p>
            {acceptedExtensions.length > 0 && (
                <p>{t('ui', 'fileDropAcceptedTypes')} {acceptedExtensions.join(', ')}</p>
            )}
          </div>
        </div>

        {/* Loading overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                <p className="text-sm font-medium">{t('ui', 'fileDropUploading')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Preview dos arquivos selecionados */}
      {showPreview && selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {selectedFiles.length} arquivo{selectedFiles.length > 1 ? 's' : ''} selecionado{selectedFiles.length > 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-1 gap-2">
            {selectedFiles.map((file) => (
              <FilePreviewCard
                key={file.id}
                file={file}
                onRemove={handleRemoveFile}
                disabled={isUploading}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Card de preview de arquivo individual
 */
interface FilePreviewCardProps {
  file: FileWithPreview;
  onRemove: (fileId: string) => void;
  disabled?: boolean;
}

const FilePreviewCard: React.FC<FilePreviewCardProps> = ({ file, onRemove, disabled }) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="flex items-center gap-3 p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
      {/* Ícone ou preview */}
      <div className="flex-shrink-0 w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden">
        {file.preview ? (
          <img src={file.preview} alt={file.name} className="w-full h-full object-cover" />
        ) : (
          <FileIcon className="w-6 h-6 text-muted-foreground" />
        )}
      </div>

        {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground">
            {formatBytes(file.size)} • {file.type || t('ui', 'fileLabel')}
        </p>
      </div>

        {/* Remove button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          if (file.id) onRemove(file.id);
        }}
        disabled={disabled}
        className="flex-shrink-0"
        aria-label={t('ui', 'removeFileAria').replace('{{name}}', file.name)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};


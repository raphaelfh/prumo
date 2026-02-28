/**
 * FileDropZone Component
 * 
 * Componente reutilizável para drag & drop de arquivos com:
 * - Suporte a múltiplos arquivos
 * - Preview visual
 * - Validação customizável
 * - Estados visuais (hover, dragging, error)
 * - Acessibilidade (keyboard navigation)
 */

import React, {useCallback, useRef, useState} from 'react';
import {cn} from '@/lib/utils';
import {AlertCircle, File, FileIcon, Upload, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Alert, AlertDescription} from '@/components/ui/alert';

export interface FileWithPreview extends File {
  preview?: string;
  id?: string;
}

export interface FileDropZoneProps {
  /**
   * Callback quando arquivos são selecionados
   */
  onFilesSelected: (files: FileWithPreview[]) => void;
  
  /**
   * Arquivos atualmente selecionados
   */
  selectedFiles?: FileWithPreview[];
  
  /**
   * Callback para remover arquivo
   */
  onFileRemove?: (fileId: string) => void;
  
  /**
   * Número máximo de arquivos
   */
  maxFiles?: number;
  
  /**
   * Tamanho máximo por arquivo (em bytes)
   */
  maxFileSize?: number;
  
  /**
   * Tipos MIME aceitos
   */
  acceptedTypes?: string[];
  
  /**
   * Extensões aceitas (ex: ['.pdf', '.doc'])
   */
  acceptedExtensions?: string[];
  
  /**
   * Texto customizado
   */
  label?: string;
  description?: string;
  
  /**
   * Estado de loading
   */
  isUploading?: boolean;
  
  /**
   * Desabilitar dropzone
   */
  disabled?: boolean;
  
  /**
   * Classe CSS customizada
   */
  className?: string;
  
  /**
   * Mostrar preview dos arquivos
   */
  showPreview?: boolean;
  
  /**
   * Callback de erro
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
  label = "Arraste arquivos aqui",
  description = "ou clique para selecionar",
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
        error: `${file.name} excede o tamanho máximo de ${(maxFileSize / 1024 / 1024).toFixed(0)}MB`
      };
    }

    // Validar tipo MIME
    if (acceptedTypes.length > 0 && !acceptedTypes.includes(file.type)) {
      // Verificar extensão como fallback
      const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
      if (acceptedExtensions.length > 0 && !acceptedExtensions.includes(extension)) {
        return {
          valid: false,
          error: `${file.name} não é um tipo de arquivo aceito`
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
    
    // Validar número máximo de arquivos
    if (selectedFiles.length + files.length > maxFiles) {
      const errorMsg = `Você pode adicionar no máximo ${maxFiles} arquivos`;
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
        // Gerar ID único e preview se for imagem
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

    // Notificar arquivos válidos
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
    
    // Só remove o estado se realmente saiu da dropzone
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
   * Handler para seleção por clique
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
        aria-label="Área de upload de arquivos"
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
            <p className="text-lg font-medium mb-1">{label}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          {/* Informações sobre limites */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Máximo: {maxFiles} arquivo{maxFiles > 1 ? 's' : ''} • Tamanho máximo: {(maxFileSize / 1024 / 1024).toFixed(0)}MB por arquivo</p>
            {acceptedExtensions.length > 0 && (
              <p>Tipos aceitos: {acceptedExtensions.join(', ')}</p>
            )}
          </div>
        </div>

        {/* Loading overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              <p className="text-sm font-medium">Enviando arquivos...</p>
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

      {/* Informações */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} • {file.type || 'Arquivo'}
        </p>
      </div>

      {/* Botão remover */}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          if (file.id) onRemove(file.id);
        }}
        disabled={disabled}
        className="flex-shrink-0"
        aria-label={`Remover ${file.name}`}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};


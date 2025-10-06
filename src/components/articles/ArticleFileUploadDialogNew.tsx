/**
 * ArticleFileUploadDialog - Versão com Drag & Drop
 * 
 * Dialog modernizado para upload de múltiplos arquivos com:
 * - Drag & Drop intuitivo
 * - Upload de múltiplos arquivos simultâneos
 * - Progress tracking em tempo real
 * - Preview de arquivos
 * - Validação robusta
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { FileDropZone, FileWithPreview } from "@/components/ui/file-drop-zone";
import { FileUploadProgress } from "@/components/ui/file-upload-progress";
import { useMultiFileUpload } from "@/hooks/useMultiFileUpload";
import { FILE_ROLES, FILE_ROLE_LABELS, FILE_ROLE_DESCRIPTIONS, FILE_UPLOAD_CONFIG } from "@/lib/file-constants";
import type { FileUploadProgressItem } from "@/components/ui/file-upload-progress";

interface ArticleFileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string;
  projectId: string;
  onFileUploaded?: () => void;
}

export function ArticleFileUploadDialog({
  open,
  onOpenChange,
  articleId,
  projectId,
  onFileUploaded
}: ArticleFileUploadDialogProps) {
  const { user } = useAuth();
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [fileRole, setFileRole] = useState<string>(FILE_ROLES.MAIN);
  const [uploadStarted, setUploadStarted] = useState(false);

  // Hook de upload múltiplo
  const {
    queue,
    isUploading,
    stats,
    addFiles,
    startUpload,
    cancelUpload,
    retryUpload,
    removeFromQueue,
    clearQueue
  } = useMultiFileUpload(projectId, articleId, {
    maxConcurrent: 3,
    maxRetries: 2,
    onComplete: (results) => {
      if (results.successful.length > 0) {
        toast.success(`${results.successful.length} arquivo(s) enviado(s) com sucesso!`);
        onFileUploaded?.();
        
        // Fechar dialog após 2 segundos
        setTimeout(() => {
          handleClose();
        }, 2000);
      }
    },
    onProgress: (progress) => {
      console.log(`Progresso geral: ${Math.round(progress)}%`);
    }
  });

  /**
   * Handler quando arquivos são selecionados no dropzone
   */
  const handleFilesSelected = (files: FileWithPreview[]) => {
    setSelectedFiles(prev => [...prev, ...files]);
  };

  /**
   * Remove arquivo da lista
   */
  const handleFileRemove = (fileId: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  /**
   * Inicia o upload
   */
  const handleUpload = async () => {
    if (!user) {
      toast.error("Você precisa estar autenticado para fazer upload");
      return;
    }

    if (selectedFiles.length === 0) {
      toast.error("Selecione pelo menos um arquivo");
      return;
    }

    // Adicionar arquivos à fila
    const files = selectedFiles.map(f => f as File);
    addFiles(files, fileRole);
    
    // Iniciar upload
    setUploadStarted(true);
    await startUpload();
  };

  /**
   * Fecha o dialog e reseta estado
   */
  const handleClose = () => {
    if (isUploading) {
      const confirm = window.confirm("Existem uploads em andamento. Deseja realmente cancelar?");
      if (!confirm) return;
    }

    setSelectedFiles([]);
    setFileRole(FILE_ROLES.MAIN);
    setUploadStarted(false);
    clearQueue();
    onOpenChange(false);
  };

  // Converter queue para formato do componente de progresso
  const progressItems: FileUploadProgressItem[] = queue.map(item => ({
    id: item.id,
    file: item.file,
    status: item.status,
    progress: item.progress,
    error: item.error,
    uploadedSize: item.uploadedSize,
    speed: item.speed
  }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Adicionar Arquivos ao Artigo</DialogTitle>
          <DialogDescription>
            {!uploadStarted 
              ? "Arraste múltiplos arquivos ou clique para selecionar. Você pode enviar até 10 arquivos simultaneamente."
              : "Acompanhe o progresso do upload dos seus arquivos."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {!uploadStarted ? (
            <>
              {/* Seleção de função do arquivo */}
              <div className="space-y-2">
                <Label htmlFor="file-role">Função dos Arquivos</Label>
                <Select value={fileRole} onValueChange={setFileRole} disabled={isUploading}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a função" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FILE_ROLE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <div className="flex flex-col items-start">
                          <span className="font-medium">{label}</span>
                          <span className="text-xs text-muted-foreground">
                            {FILE_ROLE_DESCRIPTIONS[value as keyof typeof FILE_ROLE_DESCRIPTIONS]}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Dropzone */}
              <FileDropZone
                onFilesSelected={handleFilesSelected}
                selectedFiles={selectedFiles}
                onFileRemove={handleFileRemove}
                maxFiles={10}
                maxFileSize={FILE_UPLOAD_CONFIG.MAX_SIZE_BYTES}
                acceptedTypes={FILE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES}
                acceptedExtensions={FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS}
                label="Arraste arquivos aqui"
                description="ou clique para selecionar múltiplos arquivos"
                isUploading={isUploading}
                showPreview={true}
              />
            </>
          ) : (
            /* Progress tracking */
            <FileUploadProgress
              items={progressItems}
              onCancel={cancelUpload}
              onRetry={retryUpload}
              showStats={true}
            />
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {!uploadStarted ? (
            <>
              <div className="text-sm text-muted-foreground">
                {selectedFiles.length > 0 && (
                  <span>{selectedFiles.length} arquivo(s) selecionado(s)</span>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={isUploading}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={selectedFiles.length === 0 || isUploading || !user}
                >
                  {isUploading ? "Enviando..." : `Enviar ${selectedFiles.length || ''} Arquivo(s)`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">
                {stats.completed} de {stats.total} concluídos
              </div>
              
              <Button
                onClick={handleClose}
                disabled={isUploading}
                variant={isUploading ? "outline" : "default"}
              >
                {isUploading ? "Aguarde..." : "Concluir"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


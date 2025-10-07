/**
 * ArticleFileUploadDialog - Versão Melhorada com Drag & Drop
 * 
 * Dialog modernizado para upload de múltiplos arquivos com:
 * - Drag & Drop intuitivo e responsivo
 * - Upload de múltiplos arquivos simultâneos (até 10)
 * - Progress tracking em tempo real com estatísticas
 * - Preview de arquivos com informações detalhadas
 * - Validação robusta com feedback específico
 * - Validação de arquivo MAIN único por artigo
 * - Suporte a retry e cancelamento de uploads
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, Info, FileCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
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
  const [hasMainFile, setHasMainFile] = useState(false);
  const [checkingMainFile, setCheckingMainFile] = useState(false);
  const [mainFileInfo, setMainFileInfo] = useState<{ filename: string } | null>(null);

  // Hook de upload múltiplo
  const {
    queue,
    isUploading,
    stats,
    addFiles,
    startUpload,
    cancelUpload,
    retryUpload,
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
   * Verifica se já existe arquivo MAIN para este artigo
   */
  useEffect(() => {
    const checkMainFile = async () => {
      if (!open || !articleId) return;
      
      setCheckingMainFile(true);
      try {
        // Buscar arquivo MAIN existente
        const { data, error } = await supabase
          .from('article_files')
          .select('id, original_filename, file_role')
          .eq('article_id', articleId)
          .eq('file_role', FILE_ROLES.MAIN)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error('Erro ao verificar arquivo MAIN:', error);
          return;
        }

        if (data) {
          setHasMainFile(true);
          setMainFileInfo({ filename: (data as any).original_filename || 'Arquivo sem nome' });
          // Se já existe MAIN, mudar para SUPPLEMENT por padrão
          setFileRole(FILE_ROLES.SUPPLEMENT);
        } else {
          setHasMainFile(false);
          setMainFileInfo(null);
          setFileRole(FILE_ROLES.MAIN);
        }
      } catch (error) {
        console.error('Erro ao verificar arquivo MAIN:', error);
      } finally {
        setCheckingMainFile(false);
      }
    };

    checkMainFile();
  }, [open, articleId]);

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
   * Inicia o upload com validações
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

    // Validar se está tentando adicionar arquivo MAIN quando já existe um
    if (fileRole === FILE_ROLES.MAIN && hasMainFile) {
      toast.error(
        `Já existe um arquivo principal neste artigo (${mainFileInfo?.filename}). ` +
        `Escolha outra função ou remova o arquivo principal existente primeiro.`,
        { duration: 5000 }
      );
      return;
    }

    // Validar limite de arquivos (10 por vez)
    if (selectedFiles.length > 10) {
      toast.error("Você pode enviar no máximo 10 arquivos por vez");
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
    setFileRole(hasMainFile ? FILE_ROLES.SUPPLEMENT : FILE_ROLES.MAIN);
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
              {/* Alerta sobre arquivo MAIN existente */}
              {checkingMainFile && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>Verificando arquivos existentes...</AlertDescription>
                </Alert>
              )}

              {hasMainFile && mainFileInfo && (
                <Alert>
                  <FileCheck className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Arquivo principal já existe:</strong> {mainFileInfo.filename}
                    <br />
                    <span className="text-xs text-muted-foreground">
                      Este artigo já possui um arquivo principal. Selecione outra função para os novos arquivos.
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              {/* Alerta quando tenta selecionar MAIN mas já existe */}
              {fileRole === FILE_ROLES.MAIN && hasMainFile && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Atenção:</strong> Não é possível adicionar outro arquivo principal. 
                    Cada artigo pode ter apenas UM arquivo principal. 
                    Remova o arquivo principal existente ou escolha outra função.
                  </AlertDescription>
                </Alert>
              )}

              {/* Seleção de função do arquivo */}
              <div className="space-y-2">
                <Label htmlFor="file-role">Função dos Arquivos</Label>
                <Select value={fileRole} onValueChange={setFileRole} disabled={isUploading || checkingMainFile}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a função" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FILE_ROLE_LABELS).map(([value, label]) => {
                      const isMainDisabled = value === FILE_ROLES.MAIN && hasMainFile;
                      return (
                        <SelectItem 
                          key={value} 
                          value={value}
                          disabled={isMainDisabled}
                        >
                          <div className="flex flex-col items-start">
                            <span className="font-medium">
                              {label}
                              {isMainDisabled && " (já existe)"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {FILE_ROLE_DESCRIPTIONS[value as keyof typeof FILE_ROLE_DESCRIPTIONS]}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    })}
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
                  disabled={
                    selectedFiles.length === 0 || 
                    isUploading || 
                    !user || 
                    (fileRole === FILE_ROLES.MAIN && hasMainFile) ||
                    checkingMainFile
                  }
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


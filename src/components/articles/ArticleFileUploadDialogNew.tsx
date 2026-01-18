/**
 * ArticleFileUploadDialogNew - Modal Moderno para Upload de Arquivos
 * 
 * Funcionalidades:
 * - Drag & Drop intuitivo
 * - Upload múltiplo com seleção de role por arquivo
 * - Preview de arquivos com informações detalhadas
 * - Validação robusta
 * - Progress tracking em tempo real
 * - Interface moderna e responsiva
 */

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  AlertCircle, 
  Upload, 
  X, 
  CheckCircle, 
  Clock,
  FileText,
  Loader2,
  Plus,
  FileCheck
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FILE_ROLES, FILE_ROLE_LABELS, FILE_ROLE_DESCRIPTIONS, FILE_UPLOAD_CONFIG } from "@/lib/file-constants";
import { validateFile, detectFileFormat, formatFileSize, generateStorageKey } from "@/lib/file-validation";

interface FileWithRole {
  id: string;
  file: File;
  role: string;
  preview?: string;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  progress: number;
  error?: string;
  uploadedSize?: number;
  speed?: number;
}

interface ArticleFileUploadDialogNewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string;
  projectId: string;
  onFileUploaded?: () => void;
}

export function ArticleFileUploadDialogNew({
  open,
  onOpenChange,
  articleId,
  projectId,
  onFileUploaded
}: ArticleFileUploadDialogNewProps) {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileWithRole[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMainFile, setHasMainFile] = useState(false);
  const [mainFileInfo, setMainFileInfo] = useState<{ filename: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStats, setUploadStats] = useState({
    total: 0,
    completed: 0,
    failed: 0,
    totalSize: 0,
    uploadedSize: 0
  });

  // Verificar se já existe arquivo MAIN
  useEffect(() => {
    const checkMainFile = async () => {
      if (!open || !articleId) return;
      
      try {
        const { data, error } = await supabase
          .from('article_files')
          .select('id, original_filename, file_role')
          .eq('article_id', articleId)
          .eq('file_role', FILE_ROLES.MAIN)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error('Erro ao verificar arquivo MAIN:', error);
          return;
        }

        if (data) {
          setHasMainFile(true);
          setMainFileInfo({ filename: (data as any).original_filename || 'Arquivo sem nome' });
        } else {
          setHasMainFile(false);
          setMainFileInfo(null);
        }
      } catch (error) {
        console.error('Erro ao verificar arquivo MAIN:', error);
      }
    };

    checkMainFile();
  }, [open, articleId]);

  // Drag & Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // Atualizar estatísticas
  const updateStats = useCallback(() => {
    setFiles(currentFiles => {
      const stats = {
        total: currentFiles.length,
        completed: currentFiles.filter(f => f.status === 'completed').length,
        failed: currentFiles.filter(f => f.status === 'error').length,
        totalSize: currentFiles.reduce((sum, f) => sum + f.file.size, 0),
        uploadedSize: currentFiles.reduce((sum, f) => sum + (f.uploadedSize || 0), 0)
      };
      setUploadStats(stats);
      return currentFiles;
    });
  }, []);

  // Adicionar arquivos
  const addFiles = useCallback((newFiles: File[]) => {
    const validFiles = newFiles.filter(file => {
      const validation = validateFile(file);
      if (!validation.valid) {
        toast.error(`${file.name}: ${validation.error}`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const filesWithRoles: FileWithRole[] = validFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      role: hasMainFile ? FILE_ROLES.SUPPLEMENT : FILE_ROLES.MAIN,
      status: 'pending',
      progress: 0
    }));

    setFiles(prev => [...prev, ...filesWithRoles]);
    updateStats();
  }, [hasMainFile, updateStats]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, [addFiles]);

  // Remover arquivo
  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    updateStats();
  }, [updateStats]);

  // Atualizar role do arquivo
  const updateFileRole = useCallback((fileId: string, role: string) => {
    setFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, role } : f
    ));
  }, []);

  // Upload individual de arquivo
  const uploadFile = async (fileWithRole: FileWithRole): Promise<void> => {
    const { file, role } = fileWithRole;
    
    try {
      // Atualizar status para uploading com progresso inicial
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, status: 'uploading' as const, progress: 0 }
          : f
      ));

      // Validar arquivo
      const validation = validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || "Arquivo inválido");
      }

      // Atualizar progresso: validação concluída (5%)
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, progress: 5 }
          : f
      ));

      // Verificar se já existe arquivo MAIN
      if (role === FILE_ROLES.MAIN && hasMainFile) {
        throw new Error("Já existe um arquivo principal neste artigo");
      }

      // Gerar chave de storage
      const fileName = generateStorageKey(projectId, articleId, file.name);
      
      // Detectar formato
      const detectedFormat = detectFileFormat(file);

      // Atualizar progresso: preparação concluída (10%)
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, progress: 10 }
          : f
      ));

      // Upload para storage
      const { error: uploadError } = await supabase.storage
        .from("articles")
        .upload(fileName, file);

      if (uploadError) {
        console.error("Erro no upload do storage:", uploadError);
        throw new Error("Erro ao fazer upload: " + uploadError.message);
      }

      // Atualizar progresso: upload concluído (80%)
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, progress: 80 }
          : f
      ));

      // Registrar no banco
      const { error: insertError } = await supabase.from("article_files").insert([{
        project_id: projectId,
        article_id: articleId,
        file_type: detectedFormat,
        file_role: role,
        storage_key: fileName,
        original_filename: file.name,
        bytes: file.size,
      }]);

      if (insertError) {
        console.error("Erro ao inserir no banco:", insertError);
        // Rollback: deletar arquivo do storage
        await supabase.storage.from("articles").remove([fileName]);
        throw new Error("Erro ao registrar arquivo: " + insertError.message + ". Verifique se a migração para adicionar a coluna 'file_role' foi aplicada.");
      }

      // Atualizar status: concluído (100%)
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, status: 'completed', progress: 100 }
          : f
      ));

    } catch (error: any) {
      console.error("Erro completo no upload:", error);
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, status: 'error' as const, error: error.message || "Erro desconhecido" }
          : f
      ));
      // Não fazer throw para não interromper outros uploads
      // throw error;
    }
  };

  // Upload de todos os arquivos
  const handleUpload = async () => {
    if (!user) {
      toast.error("Você precisa estar autenticado");
      return;
    }

    if (files.length === 0) {
      toast.error("Selecione pelo menos um arquivo");
      return;
    }

    // Validar roles
    const mainFiles = files.filter(f => f.role === FILE_ROLES.MAIN);
    if (mainFiles.length > 1) {
      toast.error("Apenas um arquivo pode ser marcado como principal");
      return;
    }

    if (hasMainFile && mainFiles.length > 0) {
      toast.error("Já existe um arquivo principal. Remova-o primeiro ou escolha outra função");
      return;
    }

    setIsUploading(true);

    // Atualizar status para uploading com progresso inicial 0
    setFiles(prev => prev.map(f => ({ 
      ...f, 
      status: 'uploading' as const,
      progress: 0 
    })));

    try {
      // Aguardar um momento para garantir que o estado foi atualizado e pegar os arquivos mais recentes
      let filesToUpload: FileWithRole[] = [];
      
      await new Promise<void>(resolve => {
        setFiles(currentFiles => {
          filesToUpload = currentFiles.filter(f => 
            f.status === 'uploading' || f.status === 'pending' || f.status === 'error'
          ).map(f => ({ ...f }));
          resolve();
          return currentFiles;
        });
      });

      // Fazer upload sequencial de cada arquivo
      for (const fileWithRole of filesToUpload) {
        await uploadFile(fileWithRole);
      }

      // Aguardar um momento para garantir que os estados foram atualizados
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verificar resultados após upload (usando estado atualizado)
      setFiles(currentFiles => {
        const completedFiles = currentFiles.filter(f => f.status === 'completed').length;
        const failedFiles = currentFiles.filter(f => f.status === 'error').length;

        if (failedFiles > 0 && completedFiles === 0) {
          // Todos falharam
          const errorMessages = currentFiles
            .filter(f => f.status === 'error' && f.error)
            .map(f => f.error)
            .join('; ');
          toast.error(`Erro ao fazer upload: ${errorMessages}`);
        } else if (failedFiles > 0) {
          // Alguns falharam, alguns sucederam
          toast.warning(`${completedFiles} arquivo(s) enviado(s), mas ${failedFiles} falharam. Verifique os erros acima.`);
          onFileUploaded?.();
        } else if (completedFiles > 0) {
          // Todos sucederam
          toast.success(`${completedFiles} arquivo(s) enviado(s) com sucesso!`);
          onFileUploaded?.();
          
          // Fechar após 2 segundos
          setTimeout(() => {
            handleClose();
          }, 2000);
        }
        
        return currentFiles; // Retornar sem alterações
      });

    } catch (error: any) {
      console.error("Erro no upload:", error);
      toast.error("Erro ao fazer upload dos arquivos: " + (error.message || "Erro desconhecido"));
    } finally {
      setIsUploading(false);
    }
  };

  // Fechar modal
  const handleClose = () => {
    if (isUploading) {
      const confirm = window.confirm("Existem uploads em andamento. Deseja realmente cancelar?");
      if (!confirm) return;
    }

    setFiles([]);
    setIsUploading(false);
    setIsDragOver(false);
    onOpenChange(false);
  };

  // Seleção de arquivos via input
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    addFiles(selectedFiles);
    e.target.value = ''; // Reset input
  };

  // Obter cor do status
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'uploading': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  // Obter ícone do status
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'error': return <AlertCircle className="h-4 w-4" />;
      case 'uploading': return <Loader2 className="h-4 w-4 animate-spin" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl md:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col p-0 sm:p-0 gap-0">
        <DialogHeader className="px-4 sm:px-6 pt-6 pb-4">
          <DialogTitle>Adicionar Arquivos ao Artigo</DialogTitle>
          <DialogDescription>
            Arraste arquivos ou clique para selecionar. Você pode definir a função de cada arquivo individualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6">
          {!isUploading ? (
            <>
              {/* Alerta sobre arquivo MAIN existente */}
              {hasMainFile && mainFileInfo && (
                <Alert className="mb-4">
                  <FileCheck className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Arquivo principal já existe:</strong> {mainFileInfo.filename}
                    <br />
                    <span className="text-xs text-muted-foreground">
                      Selecione "Material Suplementar" ou outra função para os novos arquivos.
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              {/* Área de Drop */}
              <Card 
                className={`mb-6 transition-colors ${
                  isDragOver ? 'border-primary bg-primary/5' : 'border-dashed'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <CardContent className="p-4 sm:p-6 md:p-8 text-center">
                  <div className="space-y-3 sm:space-y-4">
                    <div className="mx-auto w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center">
                      <Upload className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
                    </div>
                    
                    <div>
                      <h3 className="text-base sm:text-lg font-semibold">Arraste arquivos aqui</h3>
                      <p className="text-sm text-muted-foreground">
                        ou clique para selecionar múltiplos arquivos
                      </p>
                    </div>

                    <div>
                      <input
                        type="file"
                        multiple
                        accept={FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(',')}
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-upload"
                      />
                      <Button asChild size="sm" className="sm:size-default">
                        <label htmlFor="file-upload" className="cursor-pointer">
                          <Plus className="mr-2 h-4 w-4" />
                          Selecionar Arquivos
                        </label>
                      </Button>
                    </div>

                    <div className="text-xs text-muted-foreground px-2">
                      Máximo {FILE_UPLOAD_CONFIG.MAX_SIZE_MB}MB por arquivo
                      <br />
                      <span className="hidden sm:inline">
                        Formatos: {FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}
                      </span>
                      <span className="sm:hidden">
                        Formatos: .pdf, .doc, .docx, .txt, .csv, .xls, .xlsx, imagens
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Lista de Arquivos */}
              {files.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg">Arquivos Selecionados</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ScrollArea className="max-h-64 sm:max-h-96">
                      <div className="space-y-3 pr-4">
                        {files.map((fileWithRole) => (
                          <div
                            key={fileWithRole.id}
                            className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-3 border rounded-lg"
                          >
                            <div className="flex items-center gap-3 w-full sm:w-auto">
                              <div className="flex-shrink-0">
                                {getStatusIcon(fileWithRole.status)}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-1 sm:mb-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <span className="font-medium text-sm truncate">
                                      {fileWithRole.file.name}
                                    </span>
                                  </div>
                                  <Badge variant="outline" className="text-xs w-fit">
                                    {formatFileSize(fileWithRole.file.size)}
                                  </Badge>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-2 sm:mt-1">
                                  <Label className="text-xs text-muted-foreground whitespace-nowrap">
                                    Função:
                                  </Label>
                                  <Select
                                    value={fileWithRole.role}
                                    onValueChange={(value) => updateFileRole(fileWithRole.id, value)}
                                    disabled={isUploading}
                                  >
                                    <SelectTrigger className="w-full sm:w-48 h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(FILE_ROLE_LABELS).map(([value, label]) => {
                                        const isMainDisabled = value === FILE_ROLES.MAIN && hasMainFile;
                                        return (
                                          <SelectItem 
                                            key={value} 
                                            value={value}
                                            disabled={isMainDisabled}
                                            className="text-xs"
                                          >
                                            <div>
                                              <div className="font-medium">
                                                {label}
                                                {isMainDisabled && " (já existe)"}
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                {FILE_ROLE_DESCRIPTIONS[value as keyof typeof FILE_ROLE_DESCRIPTIONS]}
                                              </div>
                                            </div>
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                </div>

                                {fileWithRole.error && (
                                  <div className="mt-1 text-xs text-red-600 break-words">
                                    {fileWithRole.error}
                                  </div>
                                )}
                              </div>

                              <div className="flex-shrink-0 sm:ml-auto">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeFile(fileWithRole.id)}
                                  disabled={isUploading}
                                  className="h-8 w-8 p-0"
                                  aria-label="Remover arquivo"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Estatísticas */}
                    <div className="mt-4 pt-4 border-t">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-center text-xs sm:text-sm">
                        <div>
                          <div className="font-semibold">{uploadStats.total}</div>
                          <div className="text-muted-foreground">Total</div>
                        </div>
                        <div>
                          <div className="font-semibold text-green-600">{uploadStats.completed}</div>
                          <div className="text-muted-foreground">Prontos</div>
                        </div>
                        <div>
                          <div className="font-semibold text-blue-600">{uploadStats.total - uploadStats.completed - uploadStats.failed}</div>
                          <div className="text-muted-foreground">Pendentes</div>
                        </div>
                        <div>
                          <div className="font-semibold text-red-600">{uploadStats.failed}</div>
                          <div className="text-muted-foreground">Erros</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            /* Progress durante upload */
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg">Enviando Arquivos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {files.map((fileWithRole) => (
                    <div key={fileWithRole.id} className="space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                        <span className="text-sm font-medium truncate">{fileWithRole.file.name}</span>
                        <span className={`text-sm whitespace-nowrap ${getStatusColor(fileWithRole.status)}`}>
                          {fileWithRole.status === 'uploading' ? 'Enviando...' : 
                           fileWithRole.status === 'completed' ? 'Concluído' :
                           fileWithRole.status === 'error' ? 'Erro' : 'Pendente'}
                        </span>
                      </div>
                      
                      {(fileWithRole.status === 'uploading' || fileWithRole.status === 'pending') && (
                        <Progress value={fileWithRole.progress || 0} className="h-2" />
                      )}
                      
                      {fileWithRole.error && (
                        <div className="text-sm text-red-600 break-words">
                          {fileWithRole.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-0 px-4 sm:px-6 pt-4 pb-6 border-t">
          {!isUploading ? (
            <>
              <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                {files.length > 0 && (
                  <span>{files.length} arquivo(s) selecionado(s)</span>
                )}
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button 
                  variant="outline" 
                  onClick={handleClose} 
                  disabled={isUploading}
                  className="w-full sm:w-auto"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={files.length === 0 || isUploading || !user}
                  className="w-full sm:w-auto"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Enviar {files.length} Arquivo(s)
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                {uploadStats.completed} de {uploadStats.total} concluídos
              </div>
              
              <Button
                onClick={handleClose}
                disabled={isUploading}
                variant={isUploading ? "outline" : "default"}
                className="w-full sm:w-auto"
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

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
  FileCheck, 
  Upload, 
  X, 
  CheckCircle, 
  Clock,
  FileText,
  Loader2,
  Plus
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { FILE_ROLES, FILE_ROLE_LABELS, FILE_ROLE_DESCRIPTIONS, FILE_UPLOAD_CONFIG } from "@/lib/file-constants";
import { validateFile, detectFileFormat } from "@/lib/file-validation";

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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  // Adicionar arquivos
  const addFiles = (newFiles: File[]) => {
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
      id: Math.random().toString(36).substr(2, 9),
      file,
      role: hasMainFile ? FILE_ROLES.SUPPLEMENT : FILE_ROLES.MAIN,
      status: 'pending',
      progress: 0
    }));

    setFiles(prev => [...prev, ...filesWithRoles]);
    updateStats();
  };

  // Remover arquivo
  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    updateStats();
  };

  // Atualizar role do arquivo
  const updateFileRole = (fileId: string, role: string) => {
    setFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, role } : f
    ));
  };

  // Atualizar estatísticas
  const updateStats = () => {
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
  };

  // Upload individual de arquivo
  const uploadFile = async (fileWithRole: FileWithRole): Promise<void> => {
    const { file, role } = fileWithRole;
    
    try {
      // Validar arquivo
      const validation = validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.error || "Arquivo inválido");
      }

      // Verificar se já existe arquivo MAIN
      if (role === FILE_ROLES.MAIN && hasMainFile) {
        throw new Error("Já existe um arquivo principal neste artigo");
      }

      // Preparar nome do arquivo
      const fileExt = file.name.split('.').pop();
      const fileName = `${projectId}/${articleId}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
      
      // Detectar formato
      const detectedFormat = detectFileFormat(file);

      // Upload para storage
      const { error: uploadError } = await supabase.storage
        .from("articles")
        .upload(fileName, file);

      if (uploadError) {
        throw new Error("Erro ao fazer upload: " + uploadError.message);
      }

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
        // Rollback: deletar arquivo do storage
        await supabase.storage.from("articles").remove([fileName]);
        throw new Error("Erro ao registrar arquivo: " + insertError.message);
      }

      // Atualizar status
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, status: 'completed', progress: 100 }
          : f
      ));

    } catch (error: any) {
      setFiles(prev => prev.map(f => 
        f.id === fileWithRole.id 
          ? { ...f, status: 'error', error: error.message }
          : f
      ));
      throw error;
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

    // Atualizar status para uploading
    setFiles(prev => prev.map(f => ({ ...f, status: 'uploading' as const })));

    try {
      // Upload sequencial para evitar sobrecarga
      for (const fileWithRole of files) {
        if (fileWithRole.status === 'pending') {
          await uploadFile(fileWithRole);
        }
      }

      const completedFiles = files.filter(f => f.status === 'completed').length;
      toast.success(`${completedFiles} arquivo(s) enviado(s) com sucesso!`);
      
      onFileUploaded?.();
      
      // Fechar após 2 segundos
      setTimeout(() => {
        handleClose();
      }, 2000);

    } catch (error: any) {
      console.error("Erro no upload:", error);
      toast.error("Erro ao fazer upload dos arquivos");
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

  // Formatar tamanho de arquivo
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Adicionar Arquivos ao Artigo</DialogTitle>
          <DialogDescription>
            Arraste arquivos ou clique para selecionar. Você pode definir a função de cada arquivo individualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
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
                <CardContent className="p-8 text-center">
                  <div className="space-y-4">
                    <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-semibold">Arraste arquivos aqui</h3>
                      <p className="text-muted-foreground">
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
                      <Button asChild>
                        <label htmlFor="file-upload" className="cursor-pointer">
                          <Plus className="mr-2 h-4 w-4" />
                          Selecionar Arquivos
                        </label>
                      </Button>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Máximo {FILE_UPLOAD_CONFIG.MAX_SIZE_MB}MB por arquivo
                      <br />
                      Formatos: {FILE_UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Lista de Arquivos */}
              {files.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Arquivos Selecionados</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-96">
                      <div className="space-y-3">
                        {files.map((fileWithRole) => (
                          <div
                            key={fileWithRole.id}
                            className="flex items-center gap-4 p-3 border rounded-lg"
                          >
                            <div className="flex-shrink-0">
                              {getStatusIcon(fileWithRole.status)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium text-sm truncate">
                                  {fileWithRole.file.name}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {formatFileSize(fileWithRole.file.size)}
                                </Badge>
                              </div>

                              <div className="flex items-center gap-2">
                                <Label className="text-xs text-muted-foreground">
                                  Função:
                                </Label>
                                <Select
                                  value={fileWithRole.role}
                                  onValueChange={(value) => updateFileRole(fileWithRole.id, value)}
                                  disabled={isUploading}
                                >
                                  <SelectTrigger className="w-48 h-8 text-xs">
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
                                <div className="mt-1 text-xs text-red-600">
                                  {fileWithRole.error}
                                </div>
                              )}
                            </div>

                            <div className="flex-shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeFile(fileWithRole.id)}
                                disabled={isUploading}
                                className="h-8 w-8 p-0"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Estatísticas */}
                    <div className="mt-4 pt-4 border-t">
                      <div className="grid grid-cols-4 gap-4 text-center text-sm">
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
              <CardHeader>
                <CardTitle className="text-lg">Enviando Arquivos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {files.map((fileWithRole) => (
                    <div key={fileWithRole.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{fileWithRole.file.name}</span>
                        <span className={`text-sm ${getStatusColor(fileWithRole.status)}`}>
                          {fileWithRole.status === 'uploading' ? 'Enviando...' : 
                           fileWithRole.status === 'completed' ? 'Concluído' :
                           fileWithRole.status === 'error' ? 'Erro' : 'Pendente'}
                        </span>
                      </div>
                      
                      {fileWithRole.status === 'uploading' && (
                        <Progress value={fileWithRole.progress} className="h-2" />
                      )}
                      
                      {fileWithRole.error && (
                        <div className="text-sm text-red-600">
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

        <DialogFooter className="flex items-center justify-between">
          {!isUploading ? (
            <>
              <div className="text-sm text-muted-foreground">
                {files.length > 0 && (
                  <span>{files.length} arquivo(s) selecionado(s)</span>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={isUploading}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={files.length === 0 || isUploading || !user}
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
              <div className="text-sm text-muted-foreground">
                {uploadStats.completed} de {uploadStats.total} concluídos
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

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Upload, FileText, X, AlertCircle, Loader2, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useFileUpload } from "@/hooks/useFileUpload";
import { validateFile, formatFileSize, detectFileFormat } from "@/lib/file-validation";
import { FILE_ROLES, FILE_ROLE_LABELS, FILE_ROLE_DESCRIPTIONS } from "@/lib/file-constants";

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
  const [file, setFile] = useState<File | null>(null);
  const [fileRole, setFileRole] = useState<string>(FILE_ROLES.MAIN);
  const [detectedFileType, setDetectedFileType] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, uploading } = useFileUpload();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      // Validar arquivo imediatamente
      const validation = validateFile(selectedFile);
      if (!validation.valid) {
        setValidationError(validation.error || "Arquivo inválido");
        setFile(null);
        setDetectedFileType(null);
      } else {
        setValidationError(null);
        setFile(selectedFile);
        // Detectar formato automaticamente
        const format = validation.detectedFormat || detectFileFormat(selectedFile);
        setDetectedFileType(format);
      }
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    // Validação final antes do upload
    const validation = validateFile(file);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    const result = await uploadFile(file, projectId, articleId, fileRole);

    if (result.success) {
      toast.success("Arquivo vinculado com sucesso!");
      handleClose();
      onFileUploaded?.();
    } else {
      toast.error(result.error || "Erro ao vincular arquivo");
    }
  };

  const handleClose = () => {
    setFile(null);
    setFileRole(FILE_ROLES.MAIN);
    setDetectedFileType(null);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onOpenChange(false);
  };

  const handleRemoveFile = () => {
    setFile(null);
    setDetectedFileType(null);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Vincular Arquivo ao Artigo
          </DialogTitle>
          <DialogDescription>
            Selecione a função do arquivo no artigo. O formato será detectado automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Erro de validação */}
          {validationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {/* Função do arquivo (file_role) */}
          <div className="space-y-2">
            <Label htmlFor="file-role">Função do Arquivo</Label>
            <Select value={fileRole} onValueChange={setFileRole} disabled={uploading}>
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
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Define qual o papel deste arquivo no artigo
            </p>
          </div>

          {/* Seleção de arquivo */}
          <div className="space-y-2">
            <Label htmlFor="file">Arquivo</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={fileInputRef}
                id="file"
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                className="flex-1"
                disabled={uploading}
              />
              {file && !uploading && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleRemoveFile}
                  title="Remover arquivo"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            
            {/* Preview do arquivo selecionado */}
            {file && !validationError && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md border">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(file.size)}</span>
                    {detectedFileType && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-primary">
                          Formato: {detectedFileType}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Informação sobre limites e detecção automática */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
            <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                <strong>Formato detectado automaticamente</strong> a partir do arquivo
              </p>
              <p>Tamanho máximo: 50MB • Tipos: PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, PNG, JPG, SVG</p>
            </div>
          </div>

          {/* Botões de ação */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleClose} disabled={uploading}>
              Cancelar
            </Button>
            <Button 
              onClick={handleUpload} 
              disabled={!file || uploading || !!validationError}
              className="min-w-[100px]"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                "Vincular"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

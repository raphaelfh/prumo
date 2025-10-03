import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileText, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
  const [fileType, setFileType] = useState<string>("pdf");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;

    setUploading(true);
    try {
      // Generate unique storage key
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const storageKey = `${projectId}/${articleId}/${fileName}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from("articles")
        .upload(storageKey, file);

      if (uploadError) throw uploadError;

      // Get file info
      const { data: fileData } = await supabase.storage
        .from("articles")
        .list(`${projectId}/${articleId}`, {
          search: fileName
        });

      // Insert file record
      const { error: insertError } = await supabase
        .from("article_files")
        .insert({
          project_id: projectId,
          article_id: articleId,
          file_type: fileType,
          storage_key: storageKey,
          original_filename: file.name,
          bytes: file.size,
          md5: null, // Could be calculated if needed
        });

      if (insertError) throw insertError;

      toast.success("Arquivo vinculado com sucesso!");
      setFile(null);
      setFileType("pdf");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onFileUploaded?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error uploading file:", error);
      toast.error("Erro ao vincular arquivo");
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setFileType("pdf");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Vincular Arquivo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file-type">Tipo de Arquivo</Label>
            <Select value={fileType} onValueChange={setFileType}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="doc">DOC</SelectItem>
                <SelectItem value="docx">DOCX</SelectItem>
                <SelectItem value="txt">TXT</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Arquivo</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={fileInputRef}
                id="file"
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.txt"
                className="flex-1"
              />
              {file && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {file && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button 
              onClick={handleUpload} 
              disabled={!file || uploading}
              className="min-w-[100px]"
            >
              {uploading ? "Enviando..." : "Vincular"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

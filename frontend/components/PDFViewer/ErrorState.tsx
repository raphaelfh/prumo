import {AlertCircle, FileText} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface ErrorStateProps {
  message?: string | null;
  onRetry?: () => void;
  onUpload?: () => void;
  showUploadButton?: boolean;
}

export function ErrorState({ message, onRetry, onUpload, showUploadButton }: ErrorStateProps) {
  const isFileNotFound = message?.includes('não encontrado') || showUploadButton;
  
  return (
    <div className="flex items-center justify-center h-full min-h-[400px] w-full">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        {isFileNotFound ? (
          <FileText className="h-12 w-12 text-muted-foreground" />
        ) : (
          <AlertCircle className="h-12 w-12 text-destructive" />
        )}
        <div>
          <h3 className="font-semibold text-lg mb-2">
            {isFileNotFound ? 'PDF não vinculado' : 'Erro ao carregar PDF'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {message || (isFileNotFound 
              ? 'Este artigo ainda não possui um PDF principal vinculado.' 
              : 'Não foi possível carregar o documento. Tente novamente.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {onUpload && (
            <Button onClick={onUpload} className="bg-primary hover:bg-primary/90">
              Vincular PDF
            </Button>
          )}
          {onRetry && !isFileNotFound && (
            <Button onClick={onRetry} variant="outline">
              Tentar Novamente
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

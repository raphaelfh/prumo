/**
 * PDFViewerCore - Container principal do visualizador de PDF (SIMPLIFICADO)
 * 
 * Responsabilidades:
 * - Gerenciar o ciclo de vida do documento PDF
 * - Carregar PDF do Supabase
 * - Carregar anotações do banco
 * - Coordenar sincronização
 * - Atalhos de teclado globais
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Document } from 'react-pdf';
import { usePDFStore } from '@/stores/usePDFStore';
import { useAnnotations } from '@/hooks/useAnnotations';
import { useAnnotationSync } from '@/hooks/useAnnotationSync';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PDF_OPTIONS } from '@/lib/pdf-config';
import { PDFCanvas } from './PDFCanvas';
import { LoadingState } from '../LoadingState';
import { ErrorState } from '../ErrorState';
import { ArticleFileUploadDialogNew } from '@/components/articles/ArticleFileUploadDialogNew';

interface PDFViewerCoreProps {
  articleId: string;
  projectId: string;
  className?: string;
}

export function PDFViewerCore({ articleId, projectId, className }: PDFViewerCoreProps) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  
  const {
    url,
    setUrl,
    setArticleId,
    setNumPages,
  } = usePDFStore();

  // Hook para gerenciar anotações
  const { loadAnnotations } = useAnnotations({ articleId });
  
  // Hook de sincronização automática com o banco de dados
  useAnnotationSync({ articleId });

  // Carregar PDF e anotações
  useEffect(() => {
    loadPDF();
  }, [articleId]);

  // Atalhos de teclado globais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { undo, redo, canUndo, canRedo } = usePDFStore.getState();
      
      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) undo();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (canRedo()) redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadPDF = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Definir articleId no store
      setArticleId(articleId);

      // Buscar arquivo MAIN (principal)
      const { data: files, error: filesError } = await supabase
        .from('article_files')
        .select('storage_key, file_role, original_filename')
        .eq('article_id', articleId)
        .eq('file_role', 'MAIN')
        .maybeSingle();

      if (filesError) {
        console.error('❌ Erro ao buscar arquivo:', filesError);
        throw filesError;
      }
      
      if (!files) {
        console.warn('⚠️ Nenhum arquivo MAIN encontrado para article_id:', articleId);
        setError('PDF principal não encontrado para este artigo');
        return;
      }

      // Gerar URL assinada
      const { data: urlData, error: urlError } = await supabase.storage
        .from('articles')
        .createSignedUrl(files.storage_key, 3600);

      if (urlError) throw urlError;

      setUrl(urlData.signedUrl);

      // Carregar anotações existentes
      await loadAnnotations();
    } catch (err: any) {
      console.error('❌ Erro ao carregar PDF:', err);
      const errorMessage = err.message || 'Erro ao carregar PDF';
      setError(errorMessage);
      // Só mostra toast para erros reais (não para arquivo não encontrado)
      if (!errorMessage.includes('não encontrado')) {
        toast({
          title: 'Erro ao carregar PDF',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, [setNumPages]);

  const handleLoadError = useCallback((error: Error) => {
    console.error('❌ Erro ao carregar documento:', error);
    setError('Erro ao carregar documento PDF');
  }, []);

  const handleUploadSuccess = useCallback(() => {
    setShowUploadDialog(false);
    setError(null);
    loadPDF();
  }, []);

  const isFileNotFound = error?.includes('não encontrado');

  if (isLoading) return <LoadingState />;
  if (error || !url) {
    return (
      <>
        <ErrorState 
          message={error} 
          onRetry={!isFileNotFound ? loadPDF : undefined}
          onUpload={isFileNotFound ? () => setShowUploadDialog(true) : undefined}
          showUploadButton={isFileNotFound}
        />
        <ArticleFileUploadDialogNew
          open={showUploadDialog}
          onOpenChange={setShowUploadDialog}
          articleId={articleId}
          projectId={projectId}
          onFileUploaded={handleUploadSuccess}
        />
      </>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`pdf-viewer-core h-full w-full overflow-auto bg-muted/20 ${className || ''}`}
    >
      <Document
        file={url}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={handleLoadError}
        options={PDF_OPTIONS}
        loading={<LoadingState />}
        error={<ErrorState message="Erro ao carregar documento" />}
        className="flex justify-center p-4 md:p-8"
      >
        <PDFCanvas />
      </Document>
    </div>
  );
}

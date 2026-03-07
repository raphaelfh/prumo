/**
 * PDFViewerCore - Container principal do visualizador de PDF
 * 
 * Responsabilidades:
 * - Gerenciar o ciclo de vida do documento PDF
 * - Load PDF from Supabase
 * - Estados de loading e error
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {Document} from 'react-pdf';
import {usePDFStore} from '@/stores/usePDFStore';
import {supabase} from '@/integrations/supabase/client';
import {useToast} from '@/hooks/use-toast';
import {PDF_OPTIONS} from '@/lib/pdf-config';
import {PDFCanvas} from './PDFCanvas';
import {LoadingState} from '../LoadingState';
import {ErrorState} from '../ErrorState';
import {ArticleFileUploadDialogNew} from '@/components/articles/ArticleFileUploadDialogNew';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

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
    setPdfDocument,
    setNumPages,
    ui,
  } = usePDFStore();

  const viewMode = ui?.viewMode || 'continuous';
  const isContinuousMode = viewMode === 'continuous';

    // Load PDF

    useEffect(() => {
    loadPDF();
  }, [articleId]);

  const loadPDF = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Definir articleId no store
      setArticleId(articleId);

        // Fetch MAIN (primary) file
      const { data: files, error: filesError } = await supabase
        .from('article_files')
        .select('storage_key, file_role, original_filename')
        .eq('article_id', articleId)
        .eq('file_role', 'MAIN')
        .maybeSingle();

      if (filesError) {
          console.error('❌ Error fetching file:', filesError);
        throw filesError;
      }
      
      if (!files) {
          console.warn('⚠️ No MAIN file found for article_id:', articleId);
          setError(t('extraction', 'pdfMainNotFound'));
        return;
      }

      // Gerar URL assinada
      const { data: urlData, error: urlError } = await supabase.storage
        .from('articles')
        .createSignedUrl(files.storage_key, 3600);

      if (urlError) throw urlError;

      setUrl(urlData.signedUrl);
    } catch (err: any) {
        console.error('❌ Error loading PDF:', err);
        const errorMessage = err.message || t('extraction', 'pdfLoadErrorTitle');
      setError(errorMessage);
        if (!errorMessage.toLowerCase().includes('not found')) {
        toast({
            title: t('extraction', 'pdfLoadErrorTitle'),
          description: errorMessage,
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSuccess = useCallback((pdf: any) => {
      console.warn('PDF loaded successfully:', pdf.numPages, 'pages');
    setNumPages(pdf.numPages);
    setPdfDocument(pdf);
  }, [setNumPages, setPdfDocument]);

  const handleLoadError = useCallback((error: Error) => {
      console.error('❌ Error loading document:', error);
      setError(t('extraction', 'pdfLoadDocumentError'));
  }, []);


    const handleUploadSuccess = useCallback(() => {
    setShowUploadDialog(false);
    setError(null);
    loadPDF();
  }, []);

    const isFileNotFound = error?.toLowerCase().includes('not found');

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
      className={cn(
        'pdf-viewer-core h-full w-full bg-muted/20',
        isContinuousMode ? 'overflow-auto' : 'overflow-auto', // Permitir scroll horizontal e vertical
        className
      )}
      data-scroll-container="true"
    >
      <div
        className={cn(
          'flex',
          isContinuousMode
              ? 'justify-start min-w-full' // justify-start to avoid cutting left edge
            : 'justify-center'
        )}
        style={isContinuousMode ? {
            paddingLeft: '2rem', // Extra left padding to avoid cut-off at high zoom
          paddingRight: '1rem',
          paddingTop: '1rem',
          paddingBottom: '1rem',
        } : {
          padding: '1rem 2rem',
        }}
      >
        <Document
          file={url}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          options={PDF_OPTIONS}
          loading={<LoadingState />}
          error={<ErrorState message={t('extraction', 'pdfLoadDocumentError')}/>}
          className="flex"
        >
          <PDFCanvas />
        </Document>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import { usePDFStore } from '@/stores/usePDFStore';
import { PDFToolbar } from './PDFToolbar';
import { AnnotationOverlay } from './AnnotationOverlay';
import { Sidebar } from './Sidebar';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PDF_OPTIONS } from '@/lib/pdf-config';
import type { Annotation } from '@/types/annotation';

interface PDFViewerProps {
  articleId: string;
  className?: string;
}

export function PDFViewer({ articleId, className }: PDFViewerProps) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const {
    url,
    numPages,
    currentPage,
    scale,
    rotation,
    showAnnotations,
    setUrl,
    setNumPages,
    setAnnotations,
  } = usePDFStore();

  // Load PDF and annotations
  useEffect(() => {
    loadPDF();
  }, [articleId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { undo, redo, canUndo, canRedo } = usePDFStore.getState();
      
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

      // Fetch PDF file
      const { data: files, error: filesError } = await supabase
        .from('article_files')
        .select('storage_key')
        .eq('article_id', articleId)
        .ilike('file_type', '%pdf%')
        .maybeSingle();

      if (filesError) throw filesError;
      if (!files) throw new Error('PDF não encontrado');

      // Generate signed URL
      const { data: urlData, error: urlError } = await supabase.storage
        .from('articles')
        .createSignedUrl(files.storage_key, 3600);

      if (urlError) throw urlError;

      setUrl(urlData.signedUrl);

      // Load existing annotations
      await loadAnnotations();
      
      toast({
        title: 'PDF carregado',
        description: 'Documento carregado com sucesso',
      });
    } catch (err: any) {
      console.error('Erro ao carregar PDF:', err);
      const errorMessage = err.message || 'Erro ao carregar PDF';
      setError(errorMessage);
      toast({
        title: 'Erro ao carregar PDF',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadAnnotations = async () => {
    try {
      const { data: dbAnnotations, error } = await supabase
        .from('article_annotations')
        .select('*')
        .eq('article_id', articleId)
        .eq('status', 'active');

      if (error) throw error;

      if (dbAnnotations && dbAnnotations.length > 0) {
        // Convert from DB format to store format
        const annotations: Annotation[] = dbAnnotations.map((db) => ({
          id: db.id,
          pageNumber: db.page_number,
          type: db.type as 'highlight' | 'note' | 'area' | 'underline',
          position: db.scaled_position as any,
          comment: db.comment_text || undefined,
          color: (db.color as any)?.color || 'hsl(var(--primary))',
          opacity: (db.color as any)?.opacity || 0.3,
          createdAt: db.created_at,
          updatedAt: db.updated_at,
          authorId: db.author_id || undefined,
          status: db.status as 'active' | 'deleted',
        }));

        setAnnotations(annotations);
      }
    } catch (err) {
      console.error('Erro ao carregar anotações:', err);
      toast({
        title: 'Aviso',
        description: 'Não foi possível carregar as anotações',
        variant: 'destructive',
      });
    }
  };

  const handleLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, [setNumPages]);

  const handlePageLoadSuccess = useCallback((page: any) => {
    const { width, height } = page;
    setPageSize({ width, height });
  }, []);

  if (isLoading) return <LoadingState />;
  if (error || !url) return <ErrorState message={error} onRetry={loadPDF} />;

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <PDFToolbar />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Desktop only */}
        <Sidebar className="hidden lg:flex" />

        {/* PDF Container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-muted/20"
        >
          <Document
            file={url}
            onLoadSuccess={handleLoadSuccess}
            options={PDF_OPTIONS}
            loading={<LoadingState />}
            error={<ErrorState message="Erro ao carregar documento" />}
            className="flex justify-center p-4 md:p-8"
          >
            <div className="relative inline-block shadow-2xl">
              <Page
                pageNumber={currentPage}
                scale={scale}
                rotate={rotation}
                renderTextLayer={true}
                renderAnnotationLayer={false}
                className="bg-white"
                loading={<div className="w-full h-[800px] bg-muted animate-pulse" />}
                onLoadSuccess={handlePageLoadSuccess}
              />
              
              {/* Overlay de Anotações */}
              {showAnnotations && pageSize.width > 0 && (
                <AnnotationOverlay
                  pageNumber={currentPage}
                  pageWidth={((rotation % 180 !== 0) ? pageSize.height : pageSize.width) * scale}
                  pageHeight={((rotation % 180 !== 0) ? pageSize.width : pageSize.height) * scale}
                />
              )}
            </div>
          </Document>
        </div>
      </div>
    </div>
  );
}

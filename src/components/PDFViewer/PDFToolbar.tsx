import { 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight, 
  Download,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Highlighter,
  Square,
  MousePointer,
  Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { usePDFStore } from '@/stores/usePDFStore';
import { ColorPicker } from './ColorPicker';
import { cn } from '@/lib/utils';

export function PDFToolbar() {
  const {
    currentPage,
    numPages,
    scale,
    showAnnotations,
    annotationMode,
    currentColor,
    currentOpacity,
    canUndo,
    canRedo,
    undo,
    redo,
    zoomIn,
    zoomOut,
    resetZoom,
    nextPage,
    prevPage,
    toggleAnnotations,
    setAnnotationMode,
    setCurrentColor,
    setCurrentOpacity,
    annotations,
  } = usePDFStore();

  const activeAnnotations = annotations.filter(a => a.status === 'active');

  return (
    <div className="flex items-center gap-1 p-2 border-b bg-background flex-wrap">
      {/* Page Navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={prevPage}
          disabled={currentPage <= 1}
          title="Página Anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm px-2 whitespace-nowrap">
          {currentPage} / {numPages}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={nextPage}
          disabled={currentPage >= numPages}
          title="Próxima Página"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={zoomOut}
          disabled={scale <= 0.5}
          title="Reduzir Zoom"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-sm px-2 min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={zoomIn}
          disabled={scale >= 3.0}
          title="Aumentar Zoom"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetZoom}
          className="hidden md:flex"
        >
          Resetar
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Annotation Tools */}
      <div className="flex items-center gap-1">
        <Button
          variant={annotationMode === 'select' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => {
            console.log('🔘 Modo SELECT - Selecionar/Mover anotações');
            setAnnotationMode('select');
          }}
          title="Selecionar - Clique para selecionar e mover anotações"
        >
          <MousePointer className="h-4 w-4" />
        </Button>
        <Button
          variant={annotationMode === 'text' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => {
            console.log('🔘 Modo TEXT - Selecionar texto para destacar');
            setAnnotationMode('text');
          }}
          title="Destacar Texto - Selecione texto no PDF para criar highlight"
          className="gap-1"
        >
          <Highlighter className="h-4 w-4" />
        </Button>
        <Button
          variant={annotationMode === 'area' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => {
            console.log('🔘 Modo AREA - Desenhar caixa');
            setAnnotationMode('area');
          }}
          title="Área - Desenhe uma caixa retangular"
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Color Picker */}
      {(annotationMode === 'text' || annotationMode === 'area') && (
        <ColorPicker
          selectedColor={currentColor}
          selectedOpacity={currentOpacity}
          onColorChange={(color, opacity) => {
            setCurrentColor(color);
            setCurrentOpacity(opacity);
          }}
        />
      )}

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* History */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={undo}
          disabled={!canUndo()}
          title="Desfazer (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={redo}
          disabled={!canRedo()}
          title="Refazer (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* View Options */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleAnnotations}
        title={showAnnotations ? 'Ocultar Anotações' : 'Mostrar Anotações'}
      >
        {showAnnotations ? (
          <Eye className="h-4 w-4" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </Button>

      {/* Annotation Count */}
      {activeAnnotations.length > 0 && (
        <span className="text-xs text-muted-foreground px-2 hidden lg:block">
          {activeAnnotations.length} {activeAnnotations.length === 1 ? 'anotação' : 'anotações'}
        </span>
      )}

      <div className="flex-1" />

      {/* Export */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-2"
        title="Exportar PDF"
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Exportar</span>
      </Button>
    </div>
  );
}

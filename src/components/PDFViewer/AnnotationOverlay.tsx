import { useEffect, useRef, useState } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import type { Annotation } from '@/types/annotations-new';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, MessageSquare, CheckCircle2 } from 'lucide-react';
import { AnnotationThreadDialog } from './AnnotationThreadDialog';

interface AnnotationOverlayProps {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}

export function AnnotationOverlay({ pageNumber, pageWidth, pageHeight }: AnnotationOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  
  const {
    annotations,
    selectedAnnotationId,
    isDrawing,
    drawingState,
    isDragging,
    dragState,
    isResizing,
    resizeState,
    annotationMode,
    selectAnnotation,
    deleteAnnotation,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    startDragging,
    updateDragging,
    finishDragging,
    cancelDragging,
    startResizing,
    updateResizing,
    finishResizing,
    cancelResizing,
  } = usePDFStore();

  const pageAnnotations = annotations.filter(
    (a) => a.pageNumber === pageNumber && a.status === 'active'
  );

  // Handle mouse events for drawing
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    console.log('🖱️ MouseDown - Modo:', annotationMode, 'Target:', e.target);
    
    if (!svgRef.current) {
      console.log('❌ SVG ref não disponível');
      return;
    }
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    
    // Calculate relative coordinates (0-1)
    const x = (e.clientX - rect.left) / pageWidth;
    const y = (e.clientY - rect.top) / pageHeight;
    
    console.log('📍 Posição clicada:', { x, y, pageWidth, pageHeight });
    console.log('📊 Anotações na página:', pageAnnotations.length);
    
    // Check if clicking on an annotation in select mode
    if (annotationMode === 'select') {
      console.log('🔍 Modo SELECT - Procurando anotação clicada');
      const clickedAnnotation = pageAnnotations.find(ann => {
        const pos = ann.position;
        const isInside = x >= pos.x && x <= pos.x + pos.width &&
                        y >= pos.y && y <= pos.y + pos.height;
        console.log(`🔍 Testando anotação ${ann.id}:`, { 
          pos, 
          click: { x, y }, 
          isInside 
        });
        return isInside;
      });
      
      if (clickedAnnotation) {
        console.log('✅ Anotação encontrada:', clickedAnnotation.id);
        // Start dragging
        const offsetX = x - clickedAnnotation.position.x;
        const offsetY = y - clickedAnnotation.position.y;
        console.log('🎯 Iniciando drag com offset:', { offsetX, offsetY });
        startDragging(clickedAnnotation.id, offsetX, offsetY);
        selectAnnotation(clickedAnnotation.id);
        return;
      } else {
        console.log('⚠️ Nenhuma anotação clicada');
      }
    }
    
    // Drawing mode - Apenas AREA desenha boxes
    if (annotationMode === 'area') {
      console.log('✏️ Iniciando desenho de ÁREA');
      startDrawing(x, y, pageNumber);
    } else {
      console.log('ℹ️ Modo atual não desenha:', annotationMode);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    
    // Calculate relative coordinates (0-1)
    const x = (e.clientX - rect.left) / pageWidth;
    const y = (e.clientY - rect.top) / pageHeight;
    
    // Debug logs
    if (isDragging || isResizing) {
      console.log('🖱️ MouseMove - isDragging:', isDragging, 'isResizing:', isResizing, 'pos:', { x, y });
    }
    
    // Throttle updates for better performance
    if (isDrawing && drawingState) {
      updateDrawing(x, y);
    } else if (isDragging && dragState) {
      // Use requestAnimationFrame for smooth dragging
      requestAnimationFrame(() => {
        console.log('🎯 Atualizando drag:', { x, y, dragState });
        updateDragging(x, y);
      });
    } else if (isResizing && resizeState) {
      // Use requestAnimationFrame for smooth resizing
      requestAnimationFrame(() => {
        console.log('🔲 Atualizando resize:', { x, y, resizeState });
        updateResizing(x, y);
      });
    }
  };

  const handleMouseUp = () => {
    console.log('🖱️ MouseUp - isDrawing:', isDrawing, 'isDragging:', isDragging, 'isResizing:', isResizing);
    
    if (isDrawing) {
      console.log('✅ Finalizando desenho');
      finishDrawing();
    } else if (isDragging) {
      console.log('✅ Finalizando arrastar');
      finishDragging();
    } else if (isResizing) {
      console.log('✅ Finalizando resize');
      finishResizing();
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDrawing) cancelDrawing();
        if (isDragging) cancelDragging();
        if (isResizing) cancelResizing();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, isDragging, isResizing, cancelDrawing, cancelDragging, cancelResizing]);

  // Renderizar handles de redimensionamento
  const renderResizeHandles = (annotation: Annotation) => {
    const { position, id } = annotation;
    const x = position.x * pageWidth;
    const y = position.y * pageHeight;
    const w = position.width * pageWidth;
    const h = position.height * pageHeight;

    const handleSize = 8;
    type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
    
    const handles: { handle: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
      { handle: 'nw', cx: x, cy: y, cursor: 'nw-resize' },
      { handle: 'ne', cx: x + w, cy: y, cursor: 'ne-resize' },
      { handle: 'sw', cx: x, cy: y + h, cursor: 'sw-resize' },
      { handle: 'se', cx: x + w, cy: y + h, cursor: 'se-resize' },
      { handle: 'n', cx: x + w/2, cy: y, cursor: 'n-resize' },
      { handle: 's', cx: x + w/2, cy: y + h, cursor: 's-resize' },
      { handle: 'e', cx: x + w, cy: y + h/2, cursor: 'e-resize' },
      { handle: 'w', cx: x, cy: y + h/2, cursor: 'w-resize' },
    ];

    return (
      <g>
        {handles.map(({ handle, cx, cy, cursor }) => (
          <circle
            key={handle}
            cx={cx}
            cy={cy}
            r={handleSize}
            fill="white"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            className="transition-all"
            style={{ cursor }}
            onMouseDown={(e) => {
              e.stopPropagation();
              console.log('🔲 Handle clicado:', handle);
              const rect = svgRef.current!.getBoundingClientRect();
              const relX = (e.clientX - rect.left) / pageWidth;
              const relY = (e.clientY - rect.top) / pageHeight;
              startResizing(id, handle, position, { x: relX, y: relY });
            }}
          />
        ))}
      </g>
    );
  };

  const renderAnnotation = (annotation: Annotation) => {
    const { position, color, opacity, type, id } = annotation;
    const x = position.x * pageWidth;
    const y = position.y * pageHeight;
    const w = position.width * pageWidth;
    const h = position.height * pageHeight;

    const isSelected = selectedAnnotationId === id;
    const isHovered = hoveredId === id;

    const strokeWidth = isSelected ? 2 : isHovered ? 1.5 : 1;
    const strokeColor = isSelected ? 'hsl(var(--primary))' : color;

    return (
      <g key={id}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={color}
          fillOpacity={opacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          className="cursor-pointer transition-all"
          onClick={() => selectAnnotation(id)}
          onMouseEnter={() => setHoveredId(id)}
          onMouseLeave={() => setHoveredId(null)}
        />
        
        {/* Action buttons when selected */}
        {isSelected && (
          <foreignObject
            x={x + w - 80}
            y={y - 40}
            width={80}
            height={35}
          >
            <div className="flex gap-1 bg-background border rounded-md shadow-lg p-1">
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(id);
                  setCommentDialogOpen(true);
                }}
                title="Comentários"
              >
                <MessageSquare className="h-3 w-3" />
                {/* TODO: Implement comments functionality */}
                {/* {annotation.comments && annotation.comments.length > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
                  >
                    {annotation.comments.length}
                  </Badge>
                )} */}
              </Button>
              <Button
                size="icon"
                variant="destructive"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAnnotation(id);
                }}
                title="Deletar"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </foreignObject>
        )}
        
        {/* Comment/Thread indicator - TODO: Implement comments functionality */}
        {/* Botão de comentário - sempre visível para anotações selecionadas */}
        {isSelected && (
          <g>
            <circle
              cx={x + w - 12}
              cy={y + 12}
              r={10}
              fill="hsl(var(--primary))"
              stroke="white"
              strokeWidth={2}
              className="cursor-pointer hover:fill-hsl(var(--primary)/80) transition-all"
              onClick={(e) => {
                e.stopPropagation();
                selectAnnotation(id);
                setEditingId(id);
                setCommentDialogOpen(true);
              }}
            />
            <foreignObject x={x + w - 18} y={y + 6} width={12} height={12}>
              <MessageSquare className="h-3 w-3 text-white" />
            </foreignObject>
          </g>
        )}

        {/* Indicador de comentários - sempre visível */}
        {!isSelected && (
          <g>
            <circle
              cx={x + w - 8}
              cy={y + 8}
              r={6}
              fill="hsl(var(--muted-foreground))"
              stroke="white"
              strokeWidth={1}
              className="cursor-pointer hover:fill-hsl(var(--primary)) transition-all"
              onClick={(e) => {
                e.stopPropagation();
                selectAnnotation(id);
                setEditingId(id);
                setCommentDialogOpen(true);
              }}
            />
            <foreignObject x={x + w - 12} y={y + 4} width={8} height={8}>
              <MessageSquare className="h-2 w-2 text-white" />
            </foreignObject>
          </g>
        )}
        
        {/* Resize handles quando selecionado (apenas para tipo 'area') */}
        {isSelected && annotation.type === 'area' && annotationMode === 'select' && (
          renderResizeHandles(annotation)
        )}
      </g>
    );
  };

  const renderDrawingPreview = () => {
    if (!isDrawing || !drawingState) return null;

    const x = Math.min(drawingState.startX, drawingState.currentX) * pageWidth;
    const y = Math.min(drawingState.startY, drawingState.currentY) * pageHeight;
    const w = Math.abs(drawingState.currentX - drawingState.startX) * pageWidth;
    const h = Math.abs(drawingState.currentY - drawingState.startY) * pageHeight;

    return (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="hsl(var(--primary))"
        fillOpacity={0.2}
        stroke="hsl(var(--primary))"
        strokeWidth={2}
        strokeDasharray="5,5"
      />
    );
  };

  return (
    <>
      <svg
        ref={svgRef}
        width={pageWidth}
        height={pageHeight}
        className="absolute inset-0 z-10"
        style={{ 
          cursor: annotationMode === 'area' ? 'crosshair' : 
                  (annotationMode === 'select' && hoveredId) ? 'move' : 
                  isDragging ? 'grabbing' : 
                  annotationMode === 'select' ? 'default' : 'text',
          pointerEvents: 'auto' // Sempre permitir eventos de mouse
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {pageAnnotations.map(renderAnnotation)}
        {renderDrawingPreview()}
      </svg>

      {/* Modal de threads de comentários */}
      <AnnotationThreadDialog
        annotationId={editingId}
        open={commentDialogOpen}
        onOpenChange={setCommentDialogOpen}
      />
    </>
  );
}

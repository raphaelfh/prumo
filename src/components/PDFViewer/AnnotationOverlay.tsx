import { useEffect, useRef, useState } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import type { Annotation } from '@/types/annotation';
import { Button } from '@/components/ui/button';
import { Trash2, Edit, MessageSquare } from 'lucide-react';
import { AnnotationCommentDialog } from './AnnotationCommentDialog';

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
  } = usePDFStore();

  const pageAnnotations = annotations.filter(
    (a) => a.pageNumber === pageNumber && a.status === 'active'
  );

  // Handle mouse events for drawing
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    
    // Calculate relative coordinates (0-1)
    const x = (e.clientX - rect.left) / pageWidth;
    const y = (e.clientY - rect.top) / pageHeight;
    
    // Check if clicking on an annotation in select mode
    if (annotationMode === 'select') {
      const clickedAnnotation = pageAnnotations.find(ann => {
        const pos = ann.position;
        return x >= pos.x && x <= pos.x + pos.width &&
               y >= pos.y && y <= pos.y + pos.height;
      });
      
      if (clickedAnnotation) {
        // Start dragging
        const offsetX = x - clickedAnnotation.position.x;
        const offsetY = y - clickedAnnotation.position.y;
        startDragging(clickedAnnotation.id, offsetX, offsetY);
        selectAnnotation(clickedAnnotation.id);
        return;
      }
    }
    
    // Drawing mode
    if (annotationMode === 'area' || annotationMode === 'highlight') {
      startDrawing(x, y, pageNumber);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    
    // Calculate relative coordinates (0-1)
    const x = (e.clientX - rect.left) / pageWidth;
    const y = (e.clientY - rect.top) / pageHeight;
    
    if (isDrawing && drawingState) {
      updateDrawing(x, y);
    } else if (isDragging && dragState) {
      updateDragging(x, y);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing) {
      finishDrawing();
    } else if (isDragging) {
      finishDragging();
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDrawing) cancelDrawing();
        if (isDragging) cancelDragging();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, isDragging, cancelDrawing, cancelDragging]);

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
            x={x + w - 70}
            y={y - 35}
            width={70}
            height={30}
          >
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="secondary"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(id);
                  setCommentDialogOpen(true);
                }}
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="destructive"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAnnotation(id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </foreignObject>
        )}
        
        {/* Comment indicator */}
        {annotation.comment && (
          <circle
            cx={x + w - 10}
            cy={y + 10}
            r={6}
            fill="hsl(var(--primary))"
            stroke="white"
            strokeWidth={2}
            className="cursor-pointer"
            onClick={() => selectAnnotation(id)}
          />
        )}
      </g>
    );
  };

  const renderDrawingPreview = () => {
    if (!isDrawing || !drawingState?.start || !drawingState?.current) return null;

    const { start, current } = drawingState;
    const x = Math.min(start.x, current.x) * pageWidth;
    const y = Math.min(start.y, current.y) * pageHeight;
    const w = Math.abs(current.x - start.x) * pageWidth;
    const h = Math.abs(current.y - start.y) * pageHeight;

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
        className="absolute inset-0 pointer-events-auto"
        style={{ 
          cursor: (annotationMode === 'area' || annotationMode === 'highlight') ? 'crosshair' : 
                  (annotationMode === 'select' && hoveredId) ? 'move' : 
                  isDragging ? 'grabbing' : 'default' 
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {pageAnnotations.map(renderAnnotation)}
        {renderDrawingPreview()}
      </svg>

      <AnnotationCommentDialog
        annotationId={editingId}
        open={commentDialogOpen}
        onOpenChange={setCommentDialogOpen}
      />
    </>
  );
}

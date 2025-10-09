/**
 * AnnotationTools - Ferramentas de anotação melhoradas
 * 
 * Features:
 * - Select (selecionar e mover)
 * - Highlight (destacar texto)
 * - Area (desenhar área retangular)
 * - Note (nota adesiva - será implementada na Fase 5)
 * - ColorPicker integrado
 * - Contador de anotações
 */

import { 
  MousePointer, 
  Highlighter, 
  Square, 
  StickyNote,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { ColorPicker } from '../ColorPicker';
import { usePDFStore } from '@/stores/usePDFStore';

export function AnnotationTools() {
  const {
    annotationMode,
    showAnnotations,
    currentColor,
    currentOpacity,
    annotations,
    canUndo,
    canRedo,
    undo,
    redo,
    setAnnotationMode,
    toggleAnnotations,
    setCurrentColor,
    setCurrentOpacity,
  } = usePDFStore();

  const activeAnnotations = annotations.filter(a => a.status === 'active');

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {/* Select Tool */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={annotationMode === 'select' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setAnnotationMode('select')}
              className="h-8 w-8"
              aria-label="Selecionar (V)"
            >
              <MousePointer className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Selecionar e Mover (V)</p>
          </TooltipContent>
        </Tooltip>

        {/* Highlight Tool */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={annotationMode === 'text' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setAnnotationMode('text')}
              className="h-8 w-8"
              aria-label="Destacar Texto (H)"
            >
              <Highlighter className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Destacar Texto (H)</p>
          </TooltipContent>
        </Tooltip>

        {/* Area Tool */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={annotationMode === 'area' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setAnnotationMode('area')}
              className="h-8 w-8"
              aria-label="Área Retangular (R)"
            >
              <Square className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Área Retangular (R)</p>
          </TooltipContent>
        </Tooltip>

        {/* Note Tool (placeholder para Fase 5) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={annotationMode === 'note' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setAnnotationMode('note')}
              className="h-8 w-8"
              aria-label="Nota Adesiva (N)"
              disabled
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Nota Adesiva (Em breve)</p>
          </TooltipContent>
        </Tooltip>

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

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={undo}
              disabled={!canUndo()}
              className="h-8 w-8"
              aria-label="Desfazer (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Desfazer (Ctrl+Z)</p>
          </TooltipContent>
        </Tooltip>

        {/* Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={redo}
              disabled={!canRedo()}
              className="h-8 w-8"
              aria-label="Refazer (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refazer (Ctrl+Shift+Z)</p>
          </TooltipContent>
        </Tooltip>

        {/* Toggle Annotations */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleAnnotations}
              className="h-8 w-8"
              aria-label={showAnnotations ? 'Ocultar Anotações' : 'Mostrar Anotações'}
            >
              {showAnnotations ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{showAnnotations ? 'Ocultar Anotações' : 'Mostrar Anotações'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Annotations Count */}
        {activeAnnotations.length > 0 && (
          <Badge variant="secondary" className="h-6 text-xs hidden lg:flex">
            {activeAnnotations.length} {activeAnnotations.length === 1 ? 'anotação' : 'anotações'}
          </Badge>
        )}
      </div>
    </TooltipProvider>
  );
}


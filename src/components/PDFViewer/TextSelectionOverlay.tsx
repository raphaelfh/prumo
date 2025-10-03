import { useEffect, useRef, useCallback } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import { Button } from '@/components/ui/button';
import { Highlighter, MessageSquare } from 'lucide-react';
import type { Annotation } from '@/types/annotations-new';

interface TextSelectionOverlayProps {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}

export function TextSelectionOverlay({ pageNumber, pageWidth, pageHeight }: TextSelectionOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Selection | null>(null);
  
  const {
    annotationMode,
    textSelection,
    setTextSelection,
    createHighlightFromSelection,
  } = usePDFStore();

  // Capturar seleção de texto
  const handleTextSelection = useCallback(() => {
    if (annotationMode !== 'text') {
      setTextSelection(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setTextSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    
    console.log('📝 Texto selecionado:', selectedText);
    
    if (!selectedText) {
      setTextSelection(null);
      return;
    }

    // Verificar se a seleção está dentro da página atual
    const pageElement = overlayRef.current?.closest('.react-pdf__Page');
    if (!pageElement || !pageElement.contains(range.commonAncestorContainer)) {
      console.log('⚠️ Seleção fora da página atual');
      return;
    }

    // Obter retângulos da seleção
    const rects = Array.from(range.getClientRects());
    
    if (rects.length > 0) {
      console.log('✅ Texto selecionado com sucesso:', { 
        text: selectedText.substring(0, 50) + '...', 
        rects: rects.length 
      });
      
      setTextSelection({
        text: selectedText,
        pageNumber,
        rects: rects as DOMRect[],
      });
      selectionRef.current = selection;
    }
  }, [annotationMode, pageNumber, setTextSelection]);

  // Criar highlight da seleção
  const handleCreateHighlight = useCallback((comment?: string) => {
    if (!textSelection) {
      console.log('⚠️ Sem texto selecionado para criar highlight');
      return;
    }

    const { text, rects } = textSelection;
    console.log('🎨 Criando highlight do texto:', text.substring(0, 50));
    
    // Pegar elemento da página para calcular coordenadas relativas
    const pageElement = overlayRef.current?.closest('.react-pdf__Page');
    if (!pageElement) {
      console.log('❌ Elemento da página não encontrado');
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    
    // Calcular bounding box de todos os retângulos (em coordenadas da página)
    const minX = Math.min(...rects.map(r => r.left - pageRect.left));
    const minY = Math.min(...rects.map(r => r.top - pageRect.top));
    const maxX = Math.max(...rects.map(r => r.right - pageRect.left));
    const maxY = Math.max(...rects.map(r => r.bottom - pageRect.top));
    
    // Converter para coordenadas relativas (0-1)
    const position = {
      x: minX / pageWidth,
      y: minY / pageHeight,
      width: (maxX - minX) / pageWidth,
      height: (maxY - minY) / pageHeight,
    };

    console.log('📏 Posição do highlight:', position);

    // Adicionar anotação diretamente
    const { addAnnotation, currentColor, currentOpacity } = usePDFStore.getState();
    
    const newId = addAnnotation({
      pageNumber,
      type: 'highlight',
      position,
      selectedText: text,
      color: currentColor,
      opacity: currentOpacity,
      status: 'active',
    } as Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>);

    console.log('✅ Highlight criado com ID:', newId);

    // Limpar seleção
    if (selectionRef.current) {
      selectionRef.current.removeAllRanges();
      selectionRef.current = null;
    }
    setTextSelection(null);
  }, [textSelection, pageNumber, pageWidth, pageHeight, setTextSelection]);

  // Event listeners para seleção de texto
  useEffect(() => {
    if (annotationMode !== 'text') {
      setTextSelection(null);
      // Limpar seleção quando sair do modo text
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
      return;
    }

    console.log('👆 Modo TEXT ativo - aguardando seleção de texto');

    const handleMouseUp = () => {
      setTimeout(handleTextSelection, 50); // Delay para garantir que a seleção foi finalizada
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('⎋ ESC pressionado - limpando seleção');
        setTextSelection(null);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
        }
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [annotationMode, handleTextSelection, setTextSelection]);

  // Renderizar botões de ação para texto selecionado
  const renderSelectionActions = () => {
    if (!textSelection || textSelection.pageNumber !== pageNumber) return null;

    const { rects } = textSelection;
    if (rects.length === 0) return null;

    // Posicionar botões no final da seleção
    const lastRect = rects[rects.length - 1];
    const pageElement = overlayRef.current?.closest('.react-pdf__Page');
    const pageRect = pageElement?.getBoundingClientRect();
    
    if (!pageRect) return null;

    const x = lastRect.right - pageRect.left;
    const y = lastRect.bottom - pageRect.top + 5;

    return (
      <div
        className="absolute z-50 flex gap-1 bg-background border rounded-md shadow-lg p-1"
        style={{
          left: Math.min(x, pageWidth - 120), // Evitar overflow
          top: Math.min(y, pageHeight - 40),
        }}
      >
        <Button
          size="sm"
          variant="default"
          className="h-8 px-2"
          onClick={() => handleCreateHighlight()}
          title="Criar Destaque"
        >
          <Highlighter className="h-3 w-3 mr-1" />
          Destacar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2"
          onClick={() => {
            // TODO: Abrir dialog para adicionar comentário
            const comment = prompt('Adicionar comentário (opcional):');
            handleCreateHighlight(comment || undefined);
          }}
          title="Destacar com Comentário"
        >
          <MessageSquare className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none z-20"
      style={{
        width: pageWidth,
        height: pageHeight,
        userSelect: annotationMode === 'text' ? 'text' : 'none',
        pointerEvents: annotationMode === 'text' ? 'auto' : 'none',
      }}
    >
      {renderSelectionActions()}
    </div>
  );
}

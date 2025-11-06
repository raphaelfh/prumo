/**
 * PDFSearchHighlight - Overlay de highlights de busca usando coordenadas do PDF
 * 
 * Usa getTextContent para obter coordenadas precisas e renderiza highlights
 * como overlay SVG sobre o PDF.
 */

import React, { useEffect, useState, useRef } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

interface PDFSearchHighlightProps {
  pageNumber: number;
  pageProxy: PDFPageProxy | null;
  searchQuery: string;
  scale: number;
  rotation: number;
  currentMatchIndex: number;
  isHighlighted: boolean;
}

interface TextMatch {
  x: number;
  y: number;
  width: number;
  height: number;
  matchIndex: number;
}

export const PDFSearchHighlight: React.FC<PDFSearchHighlightProps> = ({
  pageNumber,
  pageProxy,
  searchQuery,
  scale,
  rotation,
  currentMatchIndex,
  isHighlighted,
}) => {
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const overlayRef = useRef<SVGSVGElement>(null);

  // Extrair matches com coordenadas
  useEffect(() => {
    if (!pageProxy || !searchQuery.trim()) {
      console.debug(`[PDFSearchHighlight] Página ${pageNumber}: sem pageProxy ou query vazia`);
      setMatches([]);
      return;
    }

    const extractMatches = async () => {
      try {
        console.debug(`[PDFSearchHighlight] Página ${pageNumber}: extraindo matches para "${searchQuery}"`);
        const textContent = await pageProxy.getTextContent();
        const viewportData = pageProxy.getViewport({ scale: 1 });
        
        console.debug(`[PDFSearchHighlight] Página ${pageNumber}: viewport=${viewportData.width}x${viewportData.height}, ${textContent.items.length} items`);
        setViewport({ width: viewportData.width, height: viewportData.height });

        const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escapedQuery, 'gi');
        const foundMatches: TextMatch[] = [];
        let matchIndex = 0;

        // Buscar matches item por item para obter coordenadas precisas
        textContent.items.forEach((item: any, itemIndex: number) => {
          const itemText = item.str || '';
          if (!itemText) return;

          // Buscar matches neste item
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(itemText)) !== null) {
            const transform = item.transform || [1, 0, 0, 1, 0, 0];
            
            // Coordenadas do item (transform matrix: [a, b, c, d, e, f])
            // x = transform[4] (e), y = transform[5] (f)
            const itemX = transform[4];
            const itemY = transform[5];
            
            // Tamanho da fonte (altura do item)
            const fontSize = item.height || Math.abs(transform[0]) || 12; // transform[0] é a escala horizontal
            const fontWidth = item.width || fontSize * 0.6; // Largura aproximada
            
            // Calcular posição do match dentro do item
            const matchStart = match.index;
            const matchLength = match[0].length;
            
            // Largura do caractere (assumindo fonte proporcional)
            const charWidth = itemText.length > 0 ? (fontWidth / itemText.length) : fontSize * 0.6;
            
            // Posição X do início do match
            const matchX = itemX + (matchStart * charWidth);
            
            // Em PDF.js, o sistema de coordenadas tem Y invertido (0,0 no canto inferior esquerdo)
            // Precisamos converter para o sistema de coordenadas do SVG (0,0 no canto superior esquerdo)
            // O transform[5] é o Y do baseline, então subtraímos a altura para obter o topo
            const viewportHeight = viewportData.height;
            const svgY = viewportHeight - itemY; // Inverter Y (PDF tem Y=0 no bottom)
            
            // Largura do match
            const matchWidth = matchLength * charWidth;
            
            foundMatches.push({
              x: matchX,
              y: svgY - fontSize, // Ajustar para o topo do texto
              width: matchWidth,
              height: fontSize * 1.2, // Um pouco maior para melhor visibilidade
              matchIndex: matchIndex++,
            });
            
            console.debug(`[PDFSearchHighlight] Match ${matchIndex - 1} encontrado: x=${matchX}, y=${svgY - fontSize}, width=${matchWidth}, height=${fontSize * 1.2}`);
            
            // Evitar loop infinito
            if (match[0].length === 0) {
              pattern.lastIndex++;
            }
          }
        });

        console.debug(`[PDFSearchHighlight] Página ${pageNumber}: encontrados ${foundMatches.length} matches`);
        setMatches(foundMatches);
      } catch (error) {
        console.error(`[PDFSearchHighlight] Erro ao extrair coordenadas de busca na página ${pageNumber}:`, error);
        setMatches([]);
      }
    };

    extractMatches();
  }, [pageProxy, searchQuery, pageNumber]);

  // Debug: verificar se está renderizando
  useEffect(() => {
    if (searchQuery && pageProxy) {
      console.debug(`[PDFSearchHighlight] Renderizando overlay para página ${pageNumber}:`, {
        viewport,
        matchesCount: matches.length,
        isHighlighted,
        currentMatchIndex,
      });
    }
  }, [pageNumber, searchQuery, viewport, matches.length, isHighlighted, currentMatchIndex, pageProxy]);

  if (!viewport) {
    console.debug(`[PDFSearchHighlight] Página ${pageNumber}: sem viewport`);
    return null;
  }

  if (matches.length === 0) {
    console.debug(`[PDFSearchHighlight] Página ${pageNumber}: sem matches`);
    return null;
  }

  // Aplicar scale e rotation
  const scaledWidth = viewport.width * scale;
  const scaledHeight = viewport.height * scale;

  return (
    <svg
      ref={overlayRef}
      className="absolute top-0 left-0 pointer-events-none"
      width={scaledWidth}
      height={scaledHeight}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="none"
      style={{
        zIndex: 20, // Acima do text layer (z-10) e annotation layer
        transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'top left',
        width: `${scaledWidth}px`,
        height: `${scaledHeight}px`,
      }}
    >
      {matches.map((match) => {
        const isCurrent = isHighlighted && match.matchIndex === currentMatchIndex;
        
        return (
          <rect
            key={match.matchIndex}
            x={match.x}
            y={match.y}
            width={match.width}
            height={match.height}
            fill={isCurrent ? 'rgba(253, 224, 71, 0.35)' : 'rgba(253, 224, 71, 0.25)'}
            stroke="none"
            rx={2}
            ry={2}
            data-search-match="true"
            data-page-number={pageNumber}
            data-match-index={match.matchIndex}
          />
        );
      })}
    </svg>
  );
};


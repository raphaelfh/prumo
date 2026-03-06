/**
 * usePDFSearchHighlight - Hook to manage search highlight and scroll
 * 
 * Monitora quando highlights são renderizados e faz scroll fino até o resultado atual.
 */

import {useCallback, useEffect, useRef} from 'react';

interface UsePDFSearchHighlightProps {
  pageNumber: number;
  searchQuery: string;
  currentMatchIndex: number;
  isHighlighted: boolean;
  onScrollComplete?: () => void;
}

export function usePDFSearchHighlight({
  pageNumber,
  searchQuery,
  currentMatchIndex,
  isHighlighted,
  onScrollComplete,
}: UsePDFSearchHighlightProps) {
  const scrollAttemptsRef = useRef(0);
  const maxAttempts = 10; // Máximo de tentativas de scroll
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToMatch = useCallback(() => {
    if (!isHighlighted || currentMatchIndex < 0 || !searchQuery.trim()) {
      return false;
    }

    const pageElement = document.querySelector(`[data-page-number="${pageNumber}"]`);
    if (!pageElement) {
      return false;
    }

    // Procurar pelo match específico - tentar múltiplas estratégias
    // Primeiro tentar SVG rect (overlay)
    let targetMark = pageElement.querySelector(
      `rect[data-search-match="true"][data-match-index="${currentMatchIndex}"]`
    ) as HTMLElement;

    // Fallback: tentar mark no text layer
    if (!targetMark) {
      targetMark = pageElement.querySelector(
        `mark[data-search-match="true"][data-match-index="${currentMatchIndex}"]`
      ) as HTMLElement;
    }

    // Fallback: pegar todos os marks/rects e usar o índice
    if (!targetMark) {
      const allMarks = pageElement.querySelectorAll('mark[data-search-match="true"], rect[data-search-match="true"]');
      if (allMarks.length > currentMatchIndex) {
        targetMark = allMarks[currentMatchIndex] as HTMLElement;
      }
    }

    // Debug: verificar se encontrou marks
    if (!targetMark) {
      const allMarks = pageElement.querySelectorAll('mark[data-search-match="true"], rect[data-search-match="true"]');
      console.debug(`[SearchHighlight] Página ${pageNumber}, matchIndex ${currentMatchIndex}: encontrados ${allMarks.length} marks/rects`);
    }

    if (targetMark) {
      console.debug(`[SearchHighlight] Scroll para página ${pageNumber}, matchIndex ${currentMatchIndex}`);
      // Encontrar o container de scroll correto
      const scrollContainer = document.querySelector('[data-scroll-container="true"]') as HTMLElement ||
                             pageElement.closest('.pdf-viewer-core') as HTMLElement ||
                             pageElement.closest('[class*="overflow"]') as HTMLElement ||
                             null;

      // Usar scrollIntoView que funciona melhor com containers customizados
      // Primeiro, garantir que o elemento está visível
      targetMark.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });

      // Se temos um container customizado, ajustar scroll manualmente
      if (scrollContainer) {
        requestAnimationFrame(() => {
          const rect = targetMark.getBoundingClientRect();
          const containerRect = scrollContainer.getBoundingClientRect();

            // Compute relative position
          const relativeTop = rect.top - containerRect.top + scrollContainer.scrollTop;
          const targetScroll = relativeTop - (containerRect.height / 2);
          
          scrollContainer.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth',
          });
        });
      }

      // Não aplicar nenhum estilo especial - todos os highlights devem ser idênticos
      // O scroll já é suficiente para indicar qual match está ativo

      if (onScrollComplete) {
        onScrollComplete();
      }
      
      return true; // Sucesso
    }

    return false; // Não encontrado
  }, [pageNumber, searchQuery, currentMatchIndex, isHighlighted, onScrollComplete]);

  // Usar MutationObserver para detectar quando marks são adicionados ao DOM
  useEffect(() => {
    if (!isHighlighted || currentMatchIndex < 0 || !searchQuery.trim()) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 20; // Mais tentativas

    const tryScroll = () => {
      attempts++;
      const success = scrollToMatch();
      
      if (success || attempts >= maxAttempts) {
        return;
      }

      // Tentar novamente
      setTimeout(tryScroll, 100);
    };

    // Aguardar um pouco antes de começar (para garantir que a página está renderizando)
    const initialDelay = setTimeout(() => {
      tryScroll();
    }, 300);

    // Também usar MutationObserver como backup
    const pageElement = document.querySelector(`[data-page-number="${pageNumber}"]`);
    if (pageElement) {
      const observer = new MutationObserver(() => {
        const success = scrollToMatch();
        if (success) {
          observer.disconnect();
        }
      });

      observer.observe(pageElement, {
        childList: true,
        subtree: true,
      });

      const timeout = setTimeout(() => {
        observer.disconnect();
      }, 3000);

      return () => {
        clearTimeout(initialDelay);
        observer.disconnect();
        clearTimeout(timeout);
      };
    }

    return () => {
      clearTimeout(initialDelay);
    };
  }, [pageNumber, searchQuery, currentMatchIndex, isHighlighted, scrollToMatch]);

  // Polling como fallback adicional (apenas se MutationObserver não funcionar)
  useEffect(() => {
    if (!isHighlighted || currentMatchIndex < 0 || !searchQuery.trim()) {
      scrollAttemptsRef.current = 0;
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      return;
    }

    scrollAttemptsRef.current = 0;

    // Tentar com polling como fallback (MutationObserver deve fazer o trabalho principal)
    scrollIntervalRef.current = setInterval(() => {
      scrollAttemptsRef.current++;
      
      if (scrollAttemptsRef.current >= maxAttempts) {
        if (scrollIntervalRef.current) {
          clearInterval(scrollIntervalRef.current);
          scrollIntervalRef.current = null;
        }
        return;
      }

      const success = scrollToMatch();
      if (success && scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }, 300); // Tentar a cada 300ms

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    };
  }, [pageNumber, searchQuery, currentMatchIndex, isHighlighted, scrollToMatch]);

    // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);
}


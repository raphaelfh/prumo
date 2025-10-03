import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePDFStore } from '@/stores/usePDFStore';
import { useToast } from '@/hooks/use-toast';
import type { Annotation, HighlightAnnotation, AreaAnnotation } from '@/types/annotations-new';
import { colorFromRGB, isHighlight, isArea } from '@/types/annotations-new';

interface UseAnnotationsProps {
  articleId: string;
}

export function useAnnotations({ articleId }: UseAnnotationsProps) {
  const { toast } = useToast();
  const { setAnnotations } = usePDFStore();

  console.log('🔧 useAnnotations hook inicializado para articleId:', articleId);

  const loadAnnotations = useCallback(async () => {
    try {
      console.log('📥 Carregando anotações do banco...');
      console.log('🔍 ArticleId:', articleId);

      // Verificar autenticação
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      console.log('👤 Usuário autenticado:', user?.id || 'NÃO AUTENTICADO');
      if (authError) {
        console.warn('⚠️ Erro de autenticação:', authError);
      }

      // Carregar highlights
      console.log('📝 Carregando highlights...');
      const { data: highlights, error: highlightsError } = await supabase
        .from('article_highlights')
        .select('*')
        .eq('article_id', articleId)
        .order('created_at', { ascending: true });

      if (highlightsError) {
        console.error('❌ Erro ao carregar highlights:', highlightsError);
        throw highlightsError;
      }
      console.log('✅ Highlights carregados:', highlights?.length || 0);

      // Carregar boxes
      console.log('📦 Carregando boxes...');
      const { data: boxes, error: boxesError } = await supabase
        .from('article_boxes')
        .select('*')
        .eq('article_id', articleId)
        .order('created_at', { ascending: true });

      if (boxesError) {
        console.error('❌ Erro ao carregar boxes:', boxesError);
        throw boxesError;
      }
      console.log('✅ Boxes carregados:', boxes?.length || 0);

      // Converter para formato do store
      const allAnnotations: Annotation[] = [
        ...(highlights || []).map((row): HighlightAnnotation => {
          const { color, opacity } = colorFromRGB(row.color);
          return {
            id: row.id,
            type: 'highlight',
            pageNumber: row.page_number,
            position: row.scaled_position,
            selectedText: row.selected_text,
            color,
            opacity,
            authorId: row.author_id || undefined,
            status: 'active',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }),
        ...(boxes || []).map((row): AreaAnnotation => {
          const { color, opacity } = colorFromRGB(row.color);
          return {
            id: row.id,
            type: 'area',
            pageNumber: row.page_number,
            position: row.scaled_position,
            color,
            opacity,
            authorId: row.author_id || undefined,
            status: 'active',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }),
      ];

      console.log('✅ Anotações carregadas:', {
        highlights: highlights?.length || 0,
        boxes: boxes?.length || 0,
        total: allAnnotations.length,
      });

      setAnnotations(allAnnotations);

    } catch (err) {
      console.error('❌ Erro ao carregar anotações:', err);
      toast({
        title: 'Aviso',
        description: 'Não foi possível carregar as anotações',
        variant: 'destructive',
      });
    }
  }, [articleId, setAnnotations, toast]);

  return {
    loadAnnotations,
  };
}



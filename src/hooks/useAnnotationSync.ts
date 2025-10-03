import { useEffect, useRef, useCallback } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Annotation, HighlightAnnotation, AreaAnnotation } from '@/types/annotations-new';
import { isHighlight, isArea } from '@/types/annotations-new';

interface UseAnnotationSyncProps {
  articleId: string;
}

export function useAnnotationSync({ articleId }: UseAnnotationSyncProps) {
  const { toast } = useToast();
  const annotations = usePDFStore((state) => state.annotations);
  const previousAnnotationsRef = useRef<Annotation[]>([]);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  console.log('🔄 useAnnotationSync hook inicializado para articleId:', articleId);

  // Função para converter Annotation para formato do banco
  const annotationToDbFormat = useCallback((annotation: Annotation) => {
    const baseData = {
      id: annotation.id,
      article_id: articleId,
      page_number: annotation.pageNumber,
      scaled_position: annotation.position,
      color: { ...annotation.color, opacity: annotation.opacity },
      author_id: annotation.authorId,
      created_at: annotation.createdAt,
      updated_at: annotation.updatedAt,
    };

    if (isHighlight(annotation)) {
      return {
        ...baseData,
        selected_text: annotation.selectedText,
      };
    }

    return baseData;
  }, [articleId]);

  // Função para salvar highlight no banco
  const saveHighlight = useCallback(async (annotation: HighlightAnnotation) => {
    try {
      console.log('💾 Salvando highlight no banco:', annotation.id);
      
      const dbData = annotationToDbFormat(annotation);
      
      const { error } = await supabase
        .from('article_highlights')
        .upsert(dbData, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('❌ Erro ao salvar highlight:', error);
        throw error;
      }

      console.log('✅ Highlight salvo com sucesso:', annotation.id);
    } catch (err) {
      console.error('❌ Erro ao salvar highlight:', err);
      throw err;
    }
  }, [annotationToDbFormat]);

  // Função para salvar box no banco
  const saveBox = useCallback(async (annotation: AreaAnnotation) => {
    try {
      console.log('💾 Salvando box no banco:', annotation.id);
      
      const dbData = annotationToDbFormat(annotation);
      
      const { error } = await supabase
        .from('article_boxes')
        .upsert(dbData, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('❌ Erro ao salvar box:', error);
        throw error;
      }

      console.log('✅ Box salvo com sucesso:', annotation.id);
    } catch (err) {
      console.error('❌ Erro ao salvar box:', err);
      throw err;
    }
  }, [annotationToDbFormat]);

  // Função para deletar do banco
  const deleteFromDatabase = useCallback(async (annotationId: string, type: 'highlight' | 'area') => {
    try {
      console.log('🗑️ Deletando anotação do banco:', annotationId, type);
      
      const tableName = type === 'highlight' ? 'article_highlights' : 'article_boxes';
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', annotationId);

      if (error) {
        console.error('❌ Erro ao deletar anotação:', error);
        throw error;
      }

      console.log('✅ Anotação deletada do banco:', annotationId);
    } catch (err) {
      console.error('❌ Erro ao deletar anotação:', err);
      throw err;
    }
  }, []);

  // Função principal de sincronização
  const syncAnnotations = useCallback(async () => {
    try {
      const currentAnnotations = annotations;
      const previousAnnotations = previousAnnotationsRef.current;

      console.log('🔄 Iniciando sincronização...', {
        current: currentAnnotations.length,
        previous: previousAnnotations.length,
      });

      // Verificar autenticação
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.warn('⚠️ Usuário não autenticado, pulando sincronização');
        return;
      }

      // Criar mapas para comparação
      const currentMap = new Map(currentAnnotations.map(a => [a.id, a]));
      const previousMap = new Map(previousAnnotations.map(a => [a.id, a]));

      // 1. Processar anotações novas ou modificadas
      for (const annotation of currentAnnotations) {
        const previous = previousMap.get(annotation.id);
        
        // Nova anotação ou modificada
        if (!previous || annotation.updatedAt !== previous.updatedAt) {
          console.log('📝 Processando anotação:', annotation.id, annotation.type);
          
          if (isHighlight(annotation)) {
            await saveHighlight(annotation);
          } else if (isArea(annotation)) {
            await saveBox(annotation);
          }
        }
      }

      // 2. Processar anotações deletadas
      for (const [id, previousAnnotation] of previousMap) {
        if (!currentMap.has(id)) {
          console.log('🗑️ Anotação removida:', id, previousAnnotation.type);
          await deleteFromDatabase(id, previousAnnotation.type);
        }
      }

      // Atualizar referência
      previousAnnotationsRef.current = [...currentAnnotations];

      console.log('✅ Sincronização concluída com sucesso');

    } catch (err) {
      console.error('❌ Erro na sincronização:', err);
      toast({
        title: 'Erro de Sincronização',
        description: 'Não foi possível sincronizar as anotações com o banco de dados',
        variant: 'destructive',
      });
    }
  }, [annotations, saveHighlight, saveBox, deleteFromDatabase, toast]);

  // Debounced sync
  const debouncedSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      syncAnnotations();
    }, 1000); // 1 segundo de debounce
  }, [syncAnnotations]);

  // Monitorar mudanças nas anotações
  useEffect(() => {
    // Pular a primeira execução (inicialização)
    if (previousAnnotationsRef.current.length === 0) {
      previousAnnotationsRef.current = [...annotations];
      return;
    }

    // Sincronizar apenas se houve mudanças
    const hasChanges = 
      annotations.length !== previousAnnotationsRef.current.length ||
      annotations.some((current, index) => {
        const previous = previousAnnotationsRef.current[index];
        return !previous || 
               current.id !== previous.id || 
               current.updatedAt !== previous.updatedAt;
      });

    if (hasChanges) {
      console.log('🔄 Mudanças detectadas, iniciando sincronização...');
      debouncedSync();
    }
  }, [annotations, debouncedSync]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  return {
    syncAnnotations,
  };
}



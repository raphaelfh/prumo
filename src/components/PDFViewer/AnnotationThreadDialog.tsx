import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { usePDFStore } from '@/stores/usePDFStore';
import { supabase } from '@/integrations/supabase/client';
import { MessageSquare, Reply, CheckCircle2, User, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Comment {
  id: string;
  content: string;
  author_id: string | null;
  author_name?: string;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  is_resolved: boolean;
  replies?: Comment[];
}

interface AnnotationThreadDialogProps {
  annotationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AnnotationThreadDialog({
  annotationId,
  open,
  onOpenChange,
}: AnnotationThreadDialogProps) {
  const { getAnnotation } = usePDFStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const annotation = annotationId ? getAnnotation(annotationId) : null;

  // Carregar comentários
  const loadComments = useCallback(async () => {
    if (!annotationId || !annotation) {
      console.log('⚠️ [Comments] Sem annotationId ou annotation');
      return;
    }

    console.log('💬 [Comments] Carregando comentários para:', annotationId, annotation.type);

    setLoading(true);
    try {
      // Determinar a foreign key baseada no tipo de anotação
      const getForeignKey = (annotation: any) => {
        if (annotation.type === 'highlight') return 'highlight_id';
        if (annotation.type === 'area') return 'box_id';
        return null;
      };
      
      const foreignKey = getForeignKey(annotation);
      if (!foreignKey) {
        console.warn('⚠️ [Comments] Tipo de anotação não suportado:', annotation.type);
        return;
      }
      
      console.log('🔑 [Comments] Foreign key:', foreignKey, '=', annotationId);
      
      const { data, error } = await supabase
        .from('article_annotations')
        .select(`
          *,
          profiles:author_id (
            full_name,
            email
          )
        `)
        .eq('article_id', annotation.articleId || '')
        .eq(foreignKey, annotationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ Erro ao carregar comentários:', error);
        return;
      }

      // Organizar comentários em threads
      const commentsMap = new Map<string, Comment>();
      const rootComments: Comment[] = [];

      data?.forEach((comment: any) => {
        const commentObj: Comment = {
          id: comment.id,
          content: comment.content,
          author_id: comment.author_id,
          author_name: comment.profiles?.full_name || comment.profiles?.email || 'Usuário',
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          parent_id: comment.parent_id,
          is_resolved: comment.is_resolved,
          replies: [],
        };

        commentsMap.set(comment.id, commentObj);

        if (comment.parent_id) {
          const parent = commentsMap.get(comment.parent_id);
          if (parent) {
            if (!parent.replies) parent.replies = [];
            parent.replies.push(commentObj);
          }
        } else {
          rootComments.push(commentObj);
        }
      });

      setComments(rootComments);
      console.log('✅ Comentários carregados:', rootComments);
    } catch (error) {
      console.error('❌ Erro ao carregar comentários:', error);
    } finally {
      setLoading(false);
    }
  }, [annotationId, annotation]);

  // Salvar comentário
  const saveComment = async (content: string, parentId: string | null = null) => {
    if (!annotationId || !annotation || !content.trim()) return;

    setSaving(true);
    try {
      // Usar a mesma lógica da função loadComments
      const getForeignKey = (annotation: any) => {
        if (annotation.type === 'highlight') return 'highlight_id';
        if (annotation.type === 'area') return 'box_id';
        return null;
      };
      
      const foreignKey = getForeignKey(annotation);
      if (!foreignKey) {
        console.error('❌ Tipo de anotação não suportado para comentários:', annotation.type);
        return;
      }
      
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('article_annotations')
        .insert({
          article_id: annotation.articleId || '',
          [foreignKey]: annotationId,
          parent_id: parentId,
          content: content.trim(),
          author_id: user?.id || null,
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erro ao salvar comentário:', error);
        return;
      }

      console.log('✅ Comentário salvo:', data);
      
      // Recarregar comentários
      await loadComments();
      
      // Limpar formulário
      if (parentId) {
        setReplyContent('');
        setReplyingTo(null);
      } else {
        setNewComment('');
      }
    } catch (error) {
      console.error('❌ Erro ao salvar comentário:', error);
    } finally {
      setSaving(false);
    }
  };

  // Marcar como resolvido
  const markAsResolved = async () => {
    if (!annotationId || !annotation) return;

    setSaving(true);
    try {
      // Usar a mesma lógica das outras funções
      const getForeignKey = (annotation: any) => {
        if (annotation.type === 'highlight') return 'highlight_id';
        if (annotation.type === 'area') return 'box_id';
        return null;
      };
      
      const foreignKey = getForeignKey(annotation);
      if (!foreignKey) {
        console.error('❌ Tipo de anotação não suportado para comentários:', annotation.type);
        return;
      }
      
      const { error } = await supabase
        .from('article_annotations')
        .update({ is_resolved: true })
        .eq('article_id', annotation.articleId || '')
        .eq(foreignKey, annotationId);

      if (error) {
        console.error('❌ Erro ao marcar como resolvido:', error);
        return;
      }

      console.log('✅ Marcado como resolvido');
      await loadComments();
    } catch (error) {
      console.error('❌ Erro ao marcar como resolvido:', error);
    } finally {
      setSaving(false);
    }
  };

  // Carregar comentários quando o modal abrir
  useEffect(() => {
    if (open && annotationId) {
      loadComments();
    }
  }, [open, annotationId, loadComments]);

  const renderComment = (comment: Comment, level: number = 0) => (
    <div key={comment.id} className={`space-y-3 ${level > 0 ? 'ml-6 border-l-2 border-muted pl-4' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{comment.author_name}</span>
            <Badge variant="secondary" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {formatDistanceToNow(new Date(comment.created_at), {
                addSuffix: true,
                locale: ptBR,
              })}
            </Badge>
            {comment.is_resolved && (
              <Badge variant="default" className="text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Resolvido
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{comment.content}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplyingTo(comment.id)}
              className="h-7 px-2 text-xs"
            >
              <Reply className="h-3 w-3 mr-1" />
              Responder
            </Button>
          </div>
        </div>
      </div>

      {/* Formulário de resposta */}
      {replyingTo === comment.id && (
        <div className="ml-11 space-y-2">
          <Textarea
            placeholder="Escreva sua resposta..."
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => saveComment(replyContent, comment.id)}
              disabled={saving || !replyContent.trim()}
            >
              {saving ? 'Salvando...' : 'Responder'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReplyingTo(null);
                setReplyContent('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Respostas aninhadas */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="space-y-3">
          {comment.replies.map((reply) => renderComment(reply, level + 1))}
        </div>
      )}
    </div>
  );

  if (!annotation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Discussão da Anotação
          </DialogTitle>
          <DialogDescription>
            {annotation.type === 'highlight' ? 'Texto destacado' : 'Área destacada'} - 
            Página {annotation.pageNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Comentários existentes */}
          <ScrollArea className="max-h-[400px]">
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">
                Carregando comentários...
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Nenhum comentário ainda.</p>
                <p className="text-sm">Seja o primeiro a comentar!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {comments.map((comment) => renderComment(comment))}
              </div>
            )}
          </ScrollArea>

          <Separator />

          {/* Novo comentário */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm">Adicionar comentário</h4>
            <Textarea
              placeholder="Escreva seu comentário..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => saveComment(newComment)}
                disabled={saving || !newComment.trim()}
              >
                {saving ? 'Salvando...' : 'Comentar'}
              </Button>
              {comments.length > 0 && (
                <Button
                  variant="outline"
                  onClick={markAsResolved}
                  disabled={saving}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Marcar como Resolvido
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

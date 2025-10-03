import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Zap, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AIQuickButtonProps {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;
  itemQuestion: string;
  hasResponse: boolean;
  onAccept: (level: string, comment: string) => void;
}

export const AIQuickButton = ({
  projectId,
  articleId,
  assessmentItemId,
  instrumentId,
  itemQuestion,
  hasResponse,
  onAccept
}: AIQuickButtonProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const getPdfStorageKey = async (): Promise<string> => {
    const { data, error } = await supabase
      .from('article_files')
      .select('id, file_type, storage_key, original_filename, created_at')
      .eq('article_id', articleId)
      .ilike('file_type', '%pdf%')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Erro ao buscar arquivos do artigo: ${error.message}`);
    }
    const file = data?.[0];
    const pdfStorageKey = file?.storage_key;

    if (!pdfStorageKey) {
      throw new Error('Nenhum PDF encontrado para este artigo. Faça upload do PDF primeiro.');
    }
    return pdfStorageKey;
  };

  const handleQuickAI = async () => {
    if (isProcessing || hasResponse) return;
    
    setIsProcessing(true);
    const t0 = performance.now();
    const clientTraceId = crypto.randomUUID();

    try {
      const pdfStorageKey = await getPdfStorageKey();

      // Payload com configurações padrão otimizadas
      const payload = {
        projectId,
        articleId,
        assessmentItemId,
        instrumentId,
        pdf_storage_key: pdfStorageKey,
        // Configurações padrão para avaliação rápida
        force_file_search: false, // Automático baseado no tamanho
      };

      const { data, error } = await supabase.functions.invoke('ai-assessment', {
        body: payload,
        headers: {
          'x-client-trace-id': clientTraceId,
        },
      });

      if (error) {
        let traceFromBody: string | undefined;
        try {
          const parsed = JSON.parse(error.message);
          traceFromBody = parsed?.traceId;
        } catch {
          /* ignore */
        }
        throw new Error(
          `Falha ao invocar a avaliação de IA. ${error.message}${
            traceFromBody ? ` | traceId: ${traceFromBody}` : ''
          }`
        );
      }

      const assessment = data?.assessment ?? data;
      if (!assessment) {
        throw new Error('Resposta da função sem assessment.');
      }

      // Aplica resultado automaticamente
      const evidenceBlock =
        assessment.evidence_passages?.map((e: any) => {
          const page = e.page_number != null ? ` (p.${e.page_number})` : '';
          return `• ${e.text}${page}`;
        }).join('\n') ?? '';

      const comment = `${assessment.justification}\n\n--- Evidências ---\n${evidenceBlock}`;
      onAccept(assessment.selected_level, comment);

      const took =
        data?.processingTime != null
          ? (data.processingTime / 1000).toFixed(1)
          : ((performance.now() - t0) / 1000).toFixed(1);

      toast({
        title: 'Avaliação IA concluída',
        description: `Processado em ${took}s • Nível: ${assessment.selected_level}`,
      });

    } catch (err: any) {
      console.error('[AI Quick Assessment] Erro:', err);
      toast({
        title: 'Erro na avaliação rápida',
        description: err?.message ?? 'Erro ao processar com IA',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const getButtonContent = () => {
    if (isProcessing) {
      return (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          IA...
        </>
      );
    }
    
    if (hasResponse) {
      return (
        <>
          <CheckCircle className="h-3 w-3 text-green-600" />
          Feito
        </>
      );
    }
    
    return (
      <>
        <Zap className="h-3 w-3" />
        IA Rápida
      </>
    );
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleQuickAI}
      disabled={isProcessing || hasResponse}
      className="gap-1 h-7 px-2"
      title={
        hasResponse 
          ? "Questão já respondida" 
          : isProcessing 
            ? "Processando com IA..." 
            : "Avaliação rápida com IA (configurações padrão)"
      }
    >
      {getButtonContent()}
    </Button>
  );
};

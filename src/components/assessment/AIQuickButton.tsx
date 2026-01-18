import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Zap, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { aiAssessmentClient } from '@/integrations/api/client';

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

    try {
      const pdfStorageKey = await getPdfStorageKey();

      // Payload com configurações padrão otimizadas (camelCase para FastAPI)
      const payload = {
        projectId,
        articleId,
        assessmentItemId,
        instrumentId,
        pdfStorageKey: pdfStorageKey,
        // Configurações padrão para avaliação rápida
        forceFileSearch: false, // Automático baseado no tamanho
      };

      // Usa o cliente FastAPI ao invés de Edge Function
      // O apiClient retorna data diretamente se a request for bem-sucedida
      // e lança ApiError se falhar
      const data = await aiAssessmentClient<{
        id: string;
        selectedLevel: string;
        confidenceScore: number;
        justification: string;
        evidencePassages: Array<{
          text: string;
          page_number?: number;
        }>;
        metadata?: {
          processingTimeMs?: number;
        };
      }>(payload);

      if (!data) {
        throw new Error('Resposta da API sem assessment.');
      }

      // Aplica resultado automaticamente
      const evidenceBlock =
        data.evidencePassages?.map((e) => {
          const page = e.page_number != null ? ` (p.${e.page_number})` : '';
          return `• ${e.text}${page}`;
        }).join('\n') ?? '';

      const comment = `${data.justification}\n\n--- Evidências ---\n${evidenceBlock}`;
      onAccept(data.selectedLevel, comment);

      const took =
        data.metadata?.processingTimeMs != null
          ? (data.metadata.processingTimeMs / 1000).toFixed(1)
          : ((performance.now() - t0) / 1000).toFixed(1);

      toast({
        title: 'Avaliação IA concluída',
        description: `Processado em ${took}s • Nível: ${data.selectedLevel}`,
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

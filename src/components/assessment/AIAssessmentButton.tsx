import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AIAssessmentPreview } from './AIAssessmentPreview';
import { AIPromptConfigDialog } from './AIPromptConfigDialog';

type EvidencePassage = {
  text: string;
  page_number?: number;
  relevance_score?: number;
  // campos opcionais caso sua edge function também envie offsets
  start_char?: number;
  end_char?: number;
};

type AiAssessment = {
  id: string;
  project_id: string;
  article_id: string;
  assessment_item_id: string;
  instrument_id: string;
  user_id: string;
  selected_level: string;
  confidence_score: number;
  justification: string;
  evidence_passages: EvidencePassage[];
  ai_model_used: string;
  processing_time_ms?: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  status: 'pending_review' | 'accepted' | 'rejected';
  created_at?: string;
  reviewed_at?: string | null;
  human_response?: string | null;
};

interface AIAssessmentButtonProps {
  projectId: string;
  articleId: string;
  assessmentItemId: string;
  instrumentId: string;
  itemQuestion: string;
  onAccept: (level: string, comment: string) => void;
}

export const AIAssessmentButton = ({
  projectId,
  articleId,
  assessmentItemId,
  instrumentId,
  itemQuestion,
  onAccept
}: AIAssessmentButtonProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiAssessment, setAiAssessment] = useState<AiAssessment | null>(null);
  const { toast } = useToast();

  // Correlaciona a requisição do cliente com os logs da Edge Function
  const clientTraceId = useMemo(() => crypto.randomUUID(), []);

  // Busca a storage_key do PDF (e valida que existe um PDF)
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

  const handleAIAssessment = async () => {
    setIsProcessing(true);
    const t0 = performance.now();

    try {
      const pdfStorageKey = await getPdfStorageKey();

      // Invoca a Edge Function já no modo "PDF direto"
      const { data, error } = await supabase.functions.invoke('ai-assessment', {
        body: {
          projectId,
          articleId,
          assessmentItemId,
          instrumentId,
          pdf_storage_key: pdfStorageKey, // <- chave para a função baixar e enviar ao OpenAI
          // force_file_search: true, // opcional: force RAG/Vector Store se quiser
        },
        headers: {
          'x-client-trace-id': clientTraceId, // ajuda a rastrear no log do servidor
        },
      });

      if (error) {
        // O supabase-js retorna { data, error }; quando error existe, geralmente data é undefined
        // error.message pode conter um JSON serializado vindo da Edge; tentamos extrair traceId
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

      // Estrutura esperada da função:
      // { success: true, assessment: <obj>, processingTime, traceId }
      const assessment: AiAssessment | undefined = data?.assessment ?? data;
      if (!assessment) {
        throw new Error('Resposta da função sem assessment.');
      }

      setAiAssessment(assessment);

      const took =
        data?.processingTime != null
          ? (data.processingTime / 1000).toFixed(1)
          : ((performance.now() - t0) / 1000).toFixed(1);

      toast({
        title: 'Avaliação IA concluída',
        description: `Processado em ${took}s • traceId: ${data?.traceId ?? clientTraceId}`,
      });
    } catch (err: any) {
      console.error('[AI Assessment] Erro:', err);
      toast({
        title: 'Erro na avaliação',
        description: err?.message ?? 'Erro ao processar com IA',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAccept = async () => {
    if (!aiAssessment) return;

    const evidenceBlock =
      aiAssessment.evidence_passages?.map((e) => {
        const page = e.page_number != null ? ` (p.${e.page_number})` : '';
        return `• ${e.text}${page}`;
      }).join('\n') ?? '';

    const comment = `${aiAssessment.justification}\n\n--- Evidências ---\n${evidenceBlock}`;

    onAccept(aiAssessment.selected_level, comment);

    // Atualiza status/localmente e no banco
    setAiAssessment((prev) => (prev ? { ...prev, status: 'accepted' } as AiAssessment : prev));

    const { error } = await supabase
      .from('ai_assessments')
      .update({
        status: 'accepted',
        reviewed_at: new Date().toISOString(),
        human_response: aiAssessment.selected_level,
      })
      .eq('id', aiAssessment.id);

    if (error) {
      console.error('[AI Assessment] Falha ao atualizar status accepted', error);
      toast({
        title: 'Aviso',
        description: 'Resposta aplicada, mas não foi possível atualizar o status no banco.',
      });
    } else {
      toast({ title: 'Resposta aceita', description: 'A avaliação da IA foi aplicada ao assessment.' });
    }
  };

  const handleReject = async () => {
    if (!aiAssessment) return;

    setAiAssessment((prev) => (prev ? { ...prev, status: 'rejected' } as AiAssessment : prev));

    const { error } = await supabase
      .from('ai_assessments')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', aiAssessment.id);

    if (error) {
      console.error('[AI Assessment] Falha ao atualizar status rejected', error);
      toast({
        title: 'Aviso',
        description: 'Não foi possível atualizar o status no banco.',
        variant: 'destructive',
      });
    } else {
      setAiAssessment(null);
      toast({ title: 'Resposta rejeitada', description: 'A avaliação da IA foi descartada.' });
    }
  };

  if (aiAssessment) {
    const previewAssessment = {
      selected_level: aiAssessment.selected_level,
      confidence_score: aiAssessment.confidence_score,
      justification: aiAssessment.justification,
      evidence_passages: (aiAssessment.evidence_passages ?? []).map((e) => ({
        text: e.text,
        start_char: e.start_char ?? 0,
        end_char: e.end_char ?? 0,
        page_number: e.page_number ?? 0,
        relevance_score: e.relevance_score ?? 0,
      })),
    } as const;

    return (
      <AIAssessmentPreview
        assessment={previewAssessment}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <AIPromptConfigDialog
        assessmentItemId={assessmentItemId}
        itemQuestion={itemQuestion}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAIAssessment}
        disabled={isProcessing}
        className="gap-2"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processando...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Avaliar com IA
          </>
        )}
      </Button>
    </div>
  );
};
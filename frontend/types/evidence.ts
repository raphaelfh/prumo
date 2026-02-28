/**
 * Tipos para Evidências
 * 
 * Usado em AI assessments e extraction evidence
 */

export interface EvidencePassage {
  text: string;
  file_id?: string;
  asset_id?: string;
  chunk_id?: string;
  page?: number;
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  relevance_score?: number;
  highlighted?: boolean;
}

export interface Evidence {
  id: string;
  target_type: 'value' | 'instance';
  target_id: string;
  article_file_id: string | null;
  page_number: number | null;
  position: Record<string, unknown>;
  text_content: string | null;
  created_by: string;
  created_at: string;
}


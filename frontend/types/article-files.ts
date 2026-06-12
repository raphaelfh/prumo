import {FileRole} from '@/lib/file-constants';

/**
 * TypeScript types for the article files system
 *
 * IMPORTANT:
 * - file_type = file format (PDF, DOC, etc.)
 * - file_role = file role (MAIN, SUPPLEMENT, etc.)
 */

export interface ArticleFile {
  id: string;
  project_id: string;
  article_id: string;
    file_type: string;           // Format: PDF, DOC, DOCX, etc.
    file_role?: FileRole | null; // Role: MAIN, SUPPLEMENT, etc.
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
  md5: string | null;
    // Fields for text extraction (future implementation)
    text_raw?: string | null;           // Raw extracted text
    text_html?: string | null;          // HTML extracted text
  extraction_status?: string | null;  // pending, processing, completed, failed
    extraction_error?: string | null;   // Error message if failed
    extracted_at?: string | null;       // Extraction date/time
  created_at: string;
  updated_at: string;
}



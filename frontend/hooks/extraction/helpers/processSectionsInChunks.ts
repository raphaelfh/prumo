/**
 * Helper to process sections in chunks
 *
 * Encapsulates logic to process sections split into chunks,
 * including progress updates and error handling.
 *
 * DRY: Reusable across extraction hooks.
 */

import {SectionExtractionService} from "@/services/sectionExtractionService";
import type {BatchSectionExtractionRequest} from "@/types/ai-extraction";
import {chunkArray} from "./chunkArray";
import type {ModelChildSection} from "./getModelChildSections";
import type {ExtractionProgress} from "../useBatchSectionExtractionChunked";

export interface ProcessChunksOptions {
  sections: ModelChildSection[];
  baseRequest: Omit<BatchSectionExtractionRequest, 'sectionIds' | 'pdfText'>;
  chunkSize: number;
  pdfText?: string;
  onProgress?: (progress: ExtractionProgress) => void;
}

export interface ProcessChunksResult {
  totalSuggestionsCreated: number;
  successfulSections: number;
  failedSections: number;
  completedSections: number;
  totalTokensUsed: number;
  totalDurationMs: number;
}

/**
 * Processes sections in chunks sequentially
 *
 * @param options - Processing options
 * @returns Consolidated processing result
 */
export async function processSectionsInChunks(
  options: ProcessChunksOptions
): Promise<ProcessChunksResult> {
  const { sections, baseRequest, chunkSize, pdfText, onProgress } = options;

  if (sections.length === 0) {
    return {
      totalSuggestionsCreated: 0,
      successfulSections: 0,
      failedSections: 0,
      completedSections: 0,
      totalTokensUsed: 0,
      totalDurationMs: 0,
    };
  }

  // Dividir em chunks
  const chunks = chunkArray(sections, chunkSize);
  const sectionIdChunks = chunks.map(chunk => chunk.map(s => s.id));

  // Processar cada chunk sequencialmente
  let totalSuggestionsCreated = 0;
  let successfulSections = 0;
  let failedSections = 0;
  let completedSections = 0;
  let totalTokensUsed = 0;
  let totalDurationMs = 0;

  for (let chunkIndex = 0; chunkIndex < sectionIdChunks.length; chunkIndex++) {
    const chunk = sectionIdChunks[chunkIndex];
    const sectionNames = chunk.map(id => {
      const section = sections.find(s => s.id === id);
      return section?.label || section?.name || 'Desconhecida';
    });

      // Update progress before chunk
    const progressBefore: ExtractionProgress = {
      currentChunk: chunkIndex + 1,
      totalChunks: sectionIdChunks.length,
      completedSections,
      totalSections: sections.length,
      currentSectionName: sectionNames[0] || null,
    };
    onProgress?.(progressBefore);

    try {
        // Call service with specific chunk
      const chunkRequest: BatchSectionExtractionRequest = {
        ...baseRequest,
        sectionIds: chunk,
        pdfText: pdfText || undefined,
      };

      const result = await SectionExtractionService.extractAllSections(chunkRequest);

      if (!result.data) {
        throw new Error("No data returned from chunk extraction");
      }

        // Consolidate chunk results
      const chunkSuccessful = result.data.sections.filter(s => s.success).length;
      const chunkFailed = result.data.sections.filter(s => !s.success).length;

      successfulSections += chunkSuccessful;
      failedSections += chunkFailed;
      totalSuggestionsCreated += result.data.totalSuggestionsCreated;
      totalTokensUsed += result.data.totalTokensUsed || 0;
      totalDurationMs += result.data.durationMs || 0;
      completedSections += chunk.length;

        // Update progress after chunk
      const progressAfter: ExtractionProgress = {
        currentChunk: chunkIndex + 1,
        totalChunks: sectionIdChunks.length,
        completedSections,
        totalSections: sections.length,
        currentSectionName: null,
      };
      onProgress?.(progressAfter);
    } catch (chunkError: any) {
      console.error(`[processSectionsInChunks] Erro no chunk ${chunkIndex + 1}:`, chunkError);

        // Skip failed chunk (do not propagate error)
      failedSections += chunk.length;
      completedSections += chunk.length;

        // Update progress even on error
      const progressAfter: ExtractionProgress = {
        currentChunk: chunkIndex + 1,
        totalChunks: sectionIdChunks.length,
        completedSections,
        totalSections: sections.length,
        currentSectionName: null,
      };
      onProgress?.(progressAfter);

        // Continue with next chunk

    }
  }

  return {
    totalSuggestionsCreated,
    successfulSections,
    failedSections,
    completedSections,
    totalTokensUsed,
    totalDurationMs,
  };
}


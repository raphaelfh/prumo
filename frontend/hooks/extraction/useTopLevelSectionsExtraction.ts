/**
 * Hook for top-level section extraction
 *
 * Extracts all top-level (study-level) sections that are not model subsections.
 * These sections are linked directly to the article (no parentInstanceId).
 *
 * FEATURES:
 * - Sequential extraction of top-level sections
 * - Per-section progress
 * - Error handling (continues even if some sections fail)
 * - Aggregated results
 */

import {useCallback, useState} from "react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {SectionExtractionService} from "@/services/sectionExtractionService";
import {getTopLevelSections} from "./helpers/getTopLevelSections";
import type {SectionExtractionRequest} from "@/types/ai-extraction";

/**
 * Progress of top-level section extraction
 */
export interface TopLevelSectionsProgress {
  currentSection: number;
  totalSections: number;
  currentSectionName: string | null;
  completedSections: number;
}

/**
 * Tipo de retorno do hook
 */
export interface UseTopLevelSectionsExtractionReturn {
  extractTopLevelSections: (params: {
    projectId: string;
    articleId: string;
    templateId: string;
    options?: {
      model?: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';
    };
  }) => Promise<{
    totalSections: number;
    successfulSections: number;
    failedSections: number;
    totalSuggestionsCreated: number;
  }>;
  loading: boolean;
  error: string | null;
  progress: TopLevelSectionsProgress | null;
}

/**
 * Hook for top-level section extraction
 *
 * @param options - Hook options
 * @returns Extract function, loading state, error and progress
 */
export function useTopLevelSectionsExtraction(options?: {
  onProgress?: (progress: TopLevelSectionsProgress) => void;
  onSuccess?: (result: {
    totalSections: number;
    successfulSections: number;
    failedSections: number;
    totalSuggestionsCreated: number;
  }) => void;
}): UseTopLevelSectionsExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TopLevelSectionsProgress | null>(null);

  const extractTopLevelSections = useCallback(
    async (params: {
      projectId: string;
      articleId: string;
      templateId: string;
      options?: {
        model?: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5';
      };
    }) => {
        console.log('[useTopLevelSectionsExtraction] Starting top-level sections extraction', params);
      setLoading(true);
      setError(null);
      setProgress(null);

      try {
        const { projectId, articleId, templateId, options: extractionOptions } = params;

          // 1. Fetch top-level sections list
          console.log('[useTopLevelSectionsExtraction] Fetching top-level sections...');
        const sections = await getTopLevelSections(templateId);

        if (sections.length === 0) {
            console.log('[useTopLevelSectionsExtraction] No top-level sections found');
            toast.info(t('extraction', 'noTopLevelSectionsFound'));
          return {
            totalSections: 0,
            successfulSections: 0,
            failedSections: 0,
            totalSuggestionsCreated: 0,
          };
        }

          console.log('[useTopLevelSectionsExtraction] Sections found:', sections.length);

          // 2. Process each section sequentially
        let totalSuggestionsCreated = 0;
        let successfulSections = 0;
        let failedSections = 0;

        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const sectionIndex = i + 1;
          const totalSections = sections.length;

          try {
            const request: SectionExtractionRequest = {
              projectId,
              articleId,
              templateId,
              entityTypeId: section.id,
                // NO parentInstanceId - top-level sections are linked directly to the article
              options: extractionOptions,
            };

              // Update progress before processing (with section name)
            const progressBefore: TopLevelSectionsProgress = {
              currentSection: sectionIndex,
              totalSections,
              currentSectionName: section.label,
              completedSections: i,
            };
            setProgress(progressBefore);
            options?.onProgress?.(progressBefore);

            const result = await SectionExtractionService.extractSection(request);

            if (result.data) {
              totalSuggestionsCreated += result.data.suggestionsCreated || 0;
              successfulSections++;
                console.log(`[useTopLevelSectionsExtraction] Section ${sectionIndex}/${totalSections} extracted successfully: ${section.label}`);
            } else {
              failedSections++;
                console.error(`[useTopLevelSectionsExtraction] Section ${sectionIndex}/${totalSections} failed: ${section.label}`);
            }
          } catch (sectionError: any) {
              console.error(`[useTopLevelSectionsExtraction] Error in section ${sectionIndex}/${totalSections}:`, sectionError);
            failedSections++;
              // Continue with next section
          }

            // Update progress after processing section (no name, count only)
          const progressAfter: TopLevelSectionsProgress = {
            currentSection: sectionIndex,
            totalSections,
            currentSectionName: null,
            completedSections: sectionIndex,
          };
          setProgress(progressAfter);
          options?.onProgress?.(progressAfter);
        }

          console.log('[useTopLevelSectionsExtraction] Extraction completed', {
          totalSections: sections.length,
          successfulSections,
          failedSections,
          totalSuggestionsCreated,
        });

          // Success toast with aggregated info
        if (successfulSections > 0) {
          toast.success(
              `Top-level sections extracted: ${successfulSections}/${sections.length}`,
            {
              description: failedSections > 0
                  ? `${failedSections} section(s) failed. ${totalSuggestionsCreated} suggestion(s) created.`
                  : `${totalSuggestionsCreated} suggestion(s) created.`,
              duration: 6000,
            },
          );
        } else if (failedSections > 0) {
          toast.error(
              `Failed to extract top-level sections`,
            {
                description: `All ${failedSections} section(s) failed.`,
              duration: 6000,
            },
          );
        }

        const result = {
          totalSections: sections.length,
          successfulSections,
          failedSections,
          totalSuggestionsCreated,
        };

        options?.onSuccess?.(result);
        return result;
      } catch (err: any) {
          console.error('[useTopLevelSectionsExtraction] Extraction error:', err);
          const errorMessage = err.message || t('extraction', 'errors_topLevelSectionsExtraction');
        setError(errorMessage);
          toast.error(`${t('extraction', 'errors_topLevelSectionsExtraction')}: ${errorMessage}`);
        throw err;
      } finally {
        setLoading(false);
        setProgress(null);
      }
    },
    [options],
  );

  return { extractTopLevelSections, loading, error, progress };
}



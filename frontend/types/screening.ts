/**
 * TypeScript types for the screening workflow.
 */

export interface ScreeningCriterion {
    id: string;
    type: 'inclusion' | 'exclusion';
    label: string;
    description?: string;
}

export interface ScreeningConfig {
    id: string;
    projectId: string;
    phase: 'title_abstract' | 'full_text';
    isActive: boolean;
    requireDualReview: boolean;
    blindMode: boolean;
    criteria: ScreeningCriterion[];
    aiModelName: string | null;
    aiSystemInstruction: string | null;
    createdAt: string;
    updatedAt: string;
}

export type ScreeningDecisionValue = 'include' | 'exclude' | 'maybe';

export interface ScreeningDecision {
    id: string;
    projectId: string;
    articleId: string;
    reviewerId: string;
    phase: string;
    decision: ScreeningDecisionValue;
    reason: string | null;
    criteriaResponses: Record<string, boolean>;
    isAiAssisted: boolean;
    createdAt: string;
}

export interface ScreeningConflict {
    id: string;
    projectId: string;
    articleId: string;
    phase: string;
    status: 'none' | 'conflict' | 'resolved';
    resolvedBy: string | null;
    resolvedDecision: ScreeningDecisionValue | null;
    resolvedReason: string | null;
    resolvedAt: string | null;
    createdAt: string;
}

export interface ScreeningProgressStats {
    totalArticles: number;
    screened: number;
    pending: number;
    included: number;
    excluded: number;
    maybe: number;
    conflicts: number;
}

export interface PRISMAFlowData {
    totalImported: number;
    duplicatesRemoved: number;
    titleAbstractScreened: number;
    titleAbstractExcluded: number;
    fullTextAssessed: number;
    fullTextExcluded: number;
    included: number;
}

export interface ScreeningDashboardData {
    titleAbstractProgress: ScreeningProgressStats | null;
    fullTextProgress: ScreeningProgressStats | null;
    prisma: PRISMAFlowData;
    cohensKappa: number | null;
}

export interface AIScreeningSuggestion {
    id: string;
    articleId: string;
    decision: ScreeningDecisionValue;
    relevanceScore: number | null;
    reasoning: string | null;
    criteriaEvaluations: Array<{
        criterion_id: string;
        met: boolean | null;
        reasoning: string;
    }>;
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: string;
}

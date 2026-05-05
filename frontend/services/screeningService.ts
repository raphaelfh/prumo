/**
 * API client for the screening workflow endpoints.
 */

import {apiClient} from '@/integrations/api/client';
import type {
    ScreeningConfig,
    ScreeningConflict,
    ScreeningDashboardData,
    ScreeningDecision,
    ScreeningProgressStats,
    PRISMAFlowData,
    ScreeningCriterion,
} from '@/types/screening';

// =================== CONFIG ===================

export async function getScreeningConfig(projectId: string, phase: string): Promise<ScreeningConfig | null> {
    return apiClient<ScreeningConfig | null>(`/api/v1/screening/config/${projectId}/${phase}`);
}

export async function upsertScreeningConfig(data: {
    projectId: string;
    phase: string;
    requireDualReview?: boolean;
    blindMode?: boolean;
    criteria?: ScreeningCriterion[];
    aiModelName?: string;
    aiSystemInstruction?: string;
}): Promise<ScreeningConfig> {
    return apiClient<ScreeningConfig>('/api/v1/screening/config', {
        method: 'POST',
        body: data,
    });
}

// =================== DECISIONS ===================

export async function submitDecision(data: {
    projectId: string;
    articleId: string;
    phase: string;
    decision: string;
    reason?: string;
    criteriaResponses?: Record<string, boolean>;
}): Promise<ScreeningDecision> {
    return apiClient<ScreeningDecision>('/api/v1/screening/decide', {
        method: 'POST',
        body: data,
    });
}

export async function getDecisions(projectId: string, phase: string): Promise<ScreeningDecision[]> {
    return apiClient<ScreeningDecision[]>(`/api/v1/screening/decisions/${projectId}/${phase}`);
}

// =================== PROGRESS ===================

export async function getProgress(projectId: string, phase: string): Promise<ScreeningProgressStats> {
    return apiClient<ScreeningProgressStats>(`/api/v1/screening/progress/${projectId}/${phase}`);
}

// =================== CONFLICTS ===================

export async function getConflicts(projectId: string, phase: string): Promise<ScreeningConflict[]> {
    return apiClient<ScreeningConflict[]>(`/api/v1/screening/conflicts/${projectId}/${phase}`);
}

export async function resolveConflict(conflictId: string, data: {
    decision: string;
    reason?: string;
}): Promise<ScreeningConflict> {
    return apiClient<ScreeningConflict>(`/api/v1/screening/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        body: data,
    });
}

// =================== AI SCREENING ===================

export async function aiScreenArticle(data: {
    projectId: string;
    articleId: string;
    phase: string;
    model?: string;
}): Promise<{suggestionId: string; decision: string; relevanceScore: number; reasoning: string}> {
    return apiClient('/api/v1/screening/ai', {
        method: 'POST',
        body: data,
        timeout: 120000,
    });
}

export async function aiScreenBatch(data: {
    projectId: string;
    articleIds: string[];
    phase: string;
    model?: string;
}): Promise<{success_count: number; fail_count: number; suggestion_ids: string[]}> {
    return apiClient('/api/v1/screening/ai/batch', {
        method: 'POST',
        body: data,
        timeout: 300000,
    });
}

// =================== PRISMA ===================

export async function getPRISMACounts(projectId: string): Promise<PRISMAFlowData> {
    return apiClient<PRISMAFlowData>(`/api/v1/screening/prisma/${projectId}`);
}

// =================== DASHBOARD ===================

export async function getDashboard(projectId: string, phase: string): Promise<ScreeningDashboardData> {
    return apiClient<ScreeningDashboardData>(`/api/v1/screening/dashboard/${projectId}/${phase}`);
}

// =================== BULK ===================

export async function bulkDecide(data: {
    projectId: string;
    articleIds: string[];
    phase: string;
    decision: string;
    reason?: string;
}): Promise<{count: number}> {
    return apiClient('/api/v1/screening/bulk-decide', {
        method: 'POST',
        body: data,
    });
}

export async function advanceToFullText(data: {
    projectId: string;
    articleIds?: string[];
}): Promise<{count: number}> {
    return apiClient('/api/v1/screening/advance-to-fulltext', {
        method: 'POST',
        body: data,
    });
}

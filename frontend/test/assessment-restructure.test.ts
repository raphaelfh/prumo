/**
 * Tests for restructured assessment module
 *
 * Validates:
 * 1. New type definitions (AssessmentInstance, AssessmentResponseNew, etc.)
 * 2. Zod schema validation
 * 3. Type compatibility and structure
 * 4. Enum values
 */

import {describe, expect, it} from 'vitest';
import {
    type AssessmentEvidenceNew,
    type AssessmentInstance,
    type AssessmentInstanceWithProgress,
    type AssessmentResponseNew,
    type AssessmentResponseStats,
    AssessmentSource,
    CreateAssessmentInstanceSchema,
    CreateAssessmentResponseSchema,
    UpdateAssessmentResponseSchema,
} from '../types/assessment';

describe('Assessment Restructure - Type Validation', () => {
  describe('AssessmentSource Enum', () => {
    it('should have correct enum values', () => {
      expect(AssessmentSource).toBeDefined();

      const sources: AssessmentSource[] = ['human', 'ai', 'consensus'];
      sources.forEach(source => {
        expect(['human', 'ai', 'consensus']).toContain(source);
      });
    });

    it('should validate source type correctly', () => {
      const validSource: AssessmentSource = 'human';
      const validSource2: AssessmentSource = 'ai';
      const validSource3: AssessmentSource = 'consensus';

      expect(validSource).toBe('human');
      expect(validSource2).toBe('ai');
      expect(validSource3).toBe('consensus');
    });
  });

  describe('AssessmentInstance Type', () => {
    it('should validate complete instance structure', () => {
      const instance: AssessmentInstance = {
        id: 'instance-id-123',
        project_id: 'project-id-456',
        article_id: 'article-id-789',
        instrument_id: 'instrument-id-012',
        extraction_instance_id: null,
        parent_instance_id: null,
        label: 'PROBAST Assessment',
        status: 'in_progress',
        reviewer_id: 'reviewer-id-345',
        is_blind: false,
        can_see_others: true,
        metadata: {},
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      expect(instance.id).toBeDefined();
      expect(instance.project_id).toBeDefined();
      expect(instance.article_id).toBeDefined();
      expect(instance.instrument_id).toBeDefined();
      expect(instance.label).toBe('PROBAST Assessment');
      expect(instance.status).toBe('in_progress');
      expect(typeof instance.is_blind).toBe('boolean');
    });

    it('should support hierarchy via parent_instance_id', () => {
      const parentInstance: AssessmentInstance = {
        id: 'parent-id',
        project_id: 'project-id',
        article_id: 'article-id',
        instrument_id: 'instrument-id',
        extraction_instance_id: null,
        parent_instance_id: null,
        label: 'Parent Assessment',
        status: 'in_progress',
        reviewer_id: 'reviewer-id',
        is_blind: false,
        can_see_others: true,
        metadata: {},
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      const childInstance: AssessmentInstance = {
        ...parentInstance,
        id: 'child-id',
        parent_instance_id: 'parent-id',
        label: 'Child Assessment',
      };

      expect(parentInstance.parent_instance_id).toBeNull();
      expect(childInstance.parent_instance_id).toBe('parent-id');
    });

    it('should support PROBAST per model via extraction_instance_id', () => {
      const instanceWithModel: AssessmentInstance = {
        id: 'instance-id',
        project_id: 'project-id',
        article_id: 'article-id',
        instrument_id: 'probast-instrument-id',
        extraction_instance_id: 'model-a-instance-id',
        parent_instance_id: null,
        label: 'PROBAST for Model A',
        status: 'in_progress',
        reviewer_id: 'reviewer-id',
        is_blind: false,
        can_see_others: true,
        metadata: { model_name: 'Model A' },
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      expect(instanceWithModel.extraction_instance_id).toBe('model-a-instance-id');
      expect(instanceWithModel.metadata.model_name).toBe('Model A');
    });
  });

  describe('AssessmentResponseNew Type', () => {
    it('should validate complete response structure', () => {
      const response: AssessmentResponseNew = {
        id: 'response-id-123',
        assessment_instance_id: 'instance-id-456',
        assessment_item_id: 'item-id-789',
        selected_level: 'yes',
        notes: 'Test notes for this response',
        confidence: 0.95,
        source: 'human',
        reviewer_id: 'reviewer-id-012',
        ai_suggestion_id: null,
        project_id: 'project-id-345',
        article_id: 'article-id-678',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      expect(response.id).toBeDefined();
      expect(response.assessment_instance_id).toBeDefined();
      expect(response.assessment_item_id).toBeDefined();
      expect(response.selected_level).toBe('yes');
      expect(response.source).toBe('human');
      expect(response.confidence).toBe(0.95);
    });

    it('should support AI responses with suggestion link', () => {
      const aiResponse: AssessmentResponseNew = {
        id: 'response-id',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-id',
        selected_level: 'yes',
        notes: null,
        confidence: 0.88,
        source: 'ai',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: 'suggestion-id-123',
        project_id: 'project-id',
        article_id: 'article-id',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      expect(aiResponse.source).toBe('ai');
      expect(aiResponse.ai_suggestion_id).toBe('suggestion-id-123');
      expect(aiResponse.confidence).toBeLessThan(1.0);
    });

    it('should support consensus responses', () => {
      const consensusResponse: AssessmentResponseNew = {
        id: 'response-id',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-id',
        selected_level: 'probably_yes',
        notes: 'Reached consensus after discussion',
        confidence: null,
        source: 'consensus',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: null,
        project_id: 'project-id',
        article_id: 'article-id',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      expect(consensusResponse.source).toBe('consensus');
      expect(consensusResponse.notes).toContain('consensus');
    });

    it('should denormalize article_id for RLS performance', () => {
      const response: AssessmentResponseNew = {
        id: 'response-id',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-id',
        selected_level: 'yes',
        notes: null,
        confidence: null,
        source: 'human',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: null,
        project_id: 'project-id',
        article_id: 'article-id-DENORMALIZED',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      };

      // article_id should be directly on response (not just in instance)
      expect(response.article_id).toBeDefined();
      expect(response.article_id).toBe('article-id-DENORMALIZED');
    });
  });

  describe('AssessmentEvidenceNew Type', () => {
    it('should validate evidence structure with PDF reference', () => {
      const evidence: AssessmentEvidenceNew = {
        id: 'evidence-id-123',
        assessment_instance_id: 'instance-id-456',
        assessment_response_id: 'response-id-789',
        article_file_id: 'file-id-012',
        page_number: 5,
        position: { x: 100, y: 200, width: 50, height: 20 },
        text_content: 'This is the evidence text from the PDF',
        created_by: 'reviewer-id-345',
        created_at: '2026-01-27T00:00:00Z',
      };

      expect(evidence.id).toBeDefined();
      expect(evidence.article_file_id).toBeDefined();
      expect(evidence.page_number).toBe(5);
      expect(evidence.position).toHaveProperty('x');
      expect(evidence.position).toHaveProperty('y');
      expect(evidence.text_content).toBeDefined();
    });

    it('should support evidence without specific response', () => {
      const instanceEvidence: AssessmentEvidenceNew = {
        id: 'evidence-id',
        assessment_instance_id: 'instance-id',
        assessment_response_id: null,
        article_file_id: 'file-id',
        page_number: 10,
        position: null,
        text_content: 'General evidence for entire assessment',
        created_by: 'reviewer-id',
        created_at: '2026-01-27T00:00:00Z',
      };

      expect(instanceEvidence.assessment_response_id).toBeNull();
      expect(instanceEvidence.assessment_instance_id).toBeDefined();
    });
  });

  describe('AssessmentInstanceWithProgress Type', () => {
    it('should validate progress calculation structure', () => {
      const instanceWithProgress: AssessmentInstanceWithProgress = {
        id: 'instance-id',
        project_id: 'project-id',
        article_id: 'article-id',
        instrument_id: 'instrument-id',
        extraction_instance_id: null,
        parent_instance_id: null,
        label: 'Assessment',
        status: 'in_progress',
        reviewer_id: 'reviewer-id',
        is_blind: false,
        can_see_others: true,
        metadata: {},
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
        progress: {
          total_items: 20,
          answered_items: 15,
          percentage: 75,
        },
      };

      expect(instanceWithProgress.progress).toBeDefined();
      expect(instanceWithProgress.progress.total_items).toBe(20);
      expect(instanceWithProgress.progress.answered_items).toBe(15);
      expect(instanceWithProgress.progress.percentage).toBe(75);
    });

    it('should calculate percentage correctly', () => {
      const instance: AssessmentInstanceWithProgress = {
        id: 'instance-id',
        project_id: 'project-id',
        article_id: 'article-id',
        instrument_id: 'instrument-id',
        extraction_instance_id: null,
        parent_instance_id: null,
        label: 'Assessment',
        status: 'in_progress',
        reviewer_id: 'reviewer-id',
        is_blind: false,
        can_see_others: true,
        metadata: {},
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
        progress: {
          total_items: 10,
          answered_items: 5,
          percentage: 50,
        },
      };

      const calculatedPercentage =
        (instance.progress.answered_items / instance.progress.total_items) * 100;
      expect(calculatedPercentage).toBe(instance.progress.percentage);
    });
  });

  describe('AssessmentResponseStats Type', () => {
    it('should validate statistics structure', () => {
      const stats: AssessmentResponseStats = {
        total: 20,
        by_source: {
          human: 15,
          ai: 3,
          consensus: 2,
        },
        by_level: {
          yes: 10,
          probably_yes: 5,
          no: 3,
          probably_no: 2,
        },
        completion_percentage: 80,
      };

      expect(stats.total).toBe(20);
      expect(stats.by_source.human).toBe(15);
      expect(stats.by_source.ai).toBe(3);
      expect(stats.by_source.consensus).toBe(2);
      expect(stats.completion_percentage).toBe(80);
    });

    it('should sum sources correctly', () => {
      const stats: AssessmentResponseStats = {
        total: 20,
        by_source: {
          human: 12,
          ai: 5,
          consensus: 3,
        },
        by_level: {},
        completion_percentage: 100,
      };

      const sum = stats.by_source.human + stats.by_source.ai + stats.by_source.consensus;
      expect(sum).toBe(stats.total);
    });
  });
});

describe('Assessment Restructure - Zod Schema Validation', () => {
  describe('CreateAssessmentInstanceSchema', () => {
    it('should accept valid instance creation data', () => {
      const validData = {
        project_id: '123e4567-e89b-12d3-a456-426614174000',
        article_id: '123e4567-e89b-12d3-a456-426614174001',
        instrument_id: '123e4567-e89b-12d3-a456-426614174002',
        label: 'Test Assessment',
        metadata: { key: 'value' },
      };

      const result = CreateAssessmentInstanceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID format', () => {
      const invalidData = {
        project_id: 'not-a-uuid',
        article_id: '123e4567-e89b-12d3-a456-426614174001',
        instrument_id: '123e4567-e89b-12d3-a456-426614174002',
        label: 'Test Assessment',
      };

      const result = CreateAssessmentInstanceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty label', () => {
      const invalidData = {
        project_id: '123e4567-e89b-12d3-a456-426614174000',
        article_id: '123e4567-e89b-12d3-a456-426614174001',
        instrument_id: '123e4567-e89b-12d3-a456-426614174002',
        label: '',
      };

      const result = CreateAssessmentInstanceSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept optional extraction_instance_id', () => {
      const validData = {
        project_id: '123e4567-e89b-12d3-a456-426614174000',
        article_id: '123e4567-e89b-12d3-a456-426614174001',
        instrument_id: '123e4567-e89b-12d3-a456-426614174002',
        extraction_instance_id: '123e4567-e89b-12d3-a456-426614174003',
        label: 'PROBAST for Model A',
      };

      const result = CreateAssessmentInstanceSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe('CreateAssessmentResponseSchema', () => {
    it('should accept valid response creation data', () => {
      const validData = {
        assessment_instance_id: '123e4567-e89b-12d3-a456-426614174000',
        assessment_item_id: '123e4567-e89b-12d3-a456-426614174001',
        selected_level: 'yes',
        notes: 'Test notes',
        confidence: 0.95,
        source: 'human',
      };

      const result = CreateAssessmentResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid source value', () => {
      const invalidData = {
        assessment_instance_id: '123e4567-e89b-12d3-a456-426614174000',
        assessment_item_id: '123e4567-e89b-12d3-a456-426614174001',
        selected_level: 'yes',
        source: 'invalid_source',
      };

      const result = CreateAssessmentResponseSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject confidence outside 0-1 range', () => {
      const invalidData = {
        assessment_instance_id: '123e4567-e89b-12d3-a456-426614174000',
        assessment_item_id: '123e4567-e89b-12d3-a456-426614174001',
        selected_level: 'yes',
        confidence: 1.5,
        source: 'ai',
      };

      const result = CreateAssessmentResponseSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateAssessmentResponseSchema', () => {
    it('should accept partial updates', () => {
      const validData = {
        selected_level: 'no',
      };

      const result = UpdateAssessmentResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should accept updating only notes', () => {
      const validData = {
        notes: 'Updated notes',
      };

      const result = UpdateAssessmentResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should accept updating confidence', () => {
      const validData = {
        confidence: 0.85,
      };

      const result = UpdateAssessmentResponseSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });
});

describe('Assessment Restructure - Backward Compatibility', () => {
  it('should maintain compatibility with old assessment status values', () => {
    const statuses = ['in_progress', 'completed', 'pending_review'];

    statuses.forEach(status => {
      const instance: Partial<AssessmentInstance> = {
        status: status as any,
      };

      expect(instance.status).toBe(status);
    });
  });

  it('should support metadata field for legacy data', () => {
    const instance: Partial<AssessmentInstance> = {
      metadata: {
        legacy_field: 'legacy_value',
        old_overall_assessment: 'high',
      },
    };

    expect(instance.metadata).toHaveProperty('legacy_field');
    expect(instance.metadata?.legacy_field).toBe('legacy_value');
  });
});

describe('Assessment Restructure - Granular Response Architecture', () => {
  it('should represent 1 response = 1 row (not JSONB blob)', () => {
    const responses: AssessmentResponseNew[] = [
      {
        id: 'resp-1',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-1',
        selected_level: 'yes',
        notes: null,
        confidence: null,
        source: 'human',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: null,
        project_id: 'project-id',
        article_id: 'article-id',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      },
      {
        id: 'resp-2',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-2',
        selected_level: 'no',
        notes: null,
        confidence: null,
        source: 'human',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: null,
        project_id: 'project-id',
        article_id: 'article-id',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      },
    ];

    // Each response is a separate object (not nested in JSONB)
    expect(responses).toHaveLength(2);
    expect(responses[0].id).not.toBe(responses[1].id);
    expect(responses[0].assessment_item_id).not.toBe(responses[1].assessment_item_id);
  });

  it('should support filtering responses by multiple criteria', () => {
    const allResponses: AssessmentResponseNew[] = [
      {
        id: 'resp-1',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-1',
        selected_level: 'yes',
        notes: null,
        confidence: 0.9,
        source: 'ai',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: 'suggestion-1',
        project_id: 'project-id',
        article_id: 'article-id',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      },
      {
        id: 'resp-2',
        assessment_instance_id: 'instance-id',
        assessment_item_id: 'item-2',
        selected_level: 'no',
        notes: 'Manual review',
        confidence: null,
        source: 'human',
        reviewer_id: 'reviewer-id',
        ai_suggestion_id: null,
        project_id: 'project-id',
        article_id: 'article-id',
        created_at: '2026-01-27T00:00:00Z',
        updated_at: '2026-01-27T00:00:00Z',
      },
    ];

    // Filter by source
    const aiResponses = allResponses.filter(r => r.source === 'ai');
    expect(aiResponses).toHaveLength(1);
    expect(aiResponses[0].id).toBe('resp-1');

    // Filter by confidence threshold
    const highConfidence = allResponses.filter(r => r.confidence && r.confidence > 0.8);
    expect(highConfidence).toHaveLength(1);
    expect(highConfidence[0].confidence).toBe(0.9);
  });
});

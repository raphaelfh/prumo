import { describe, expect, it } from 'vitest';
import { t } from '@/lib/copy';

describe('runs copy namespace', () => {
  it('resolves shared run-header keys', () => {
    expect(t('runs', 'revision')).toBe('Revision');
    expect(t('runs', 'stageConsensus')).toBe('Consensus');
    expect(t('runs', 'finalize')).toBe('Finalize');
  });

  it('resolves the stage-vocabulary + help + sidebar keys', () => {
    expect(t('runs', 'stageExtract')).toBe('Extraction');
    expect(t('runs', 'stageAssessment')).toBe('Assessment');
    expect(t('runs', 'stagePending')).toBe('Pending');
    expect(t('runs', 'stageCancelled')).toBe('Cancelled');
    expect(t('runs', 'stageExplainExtract')).not.toBe('');
    expect(t('runs', 'stageExplainExtractArbiter')).not.toBe('');
    expect(t('runs', 'stageExplainConsensus')).not.toBe('');
    expect(t('runs', 'stageExplainConsensusArbiter')).not.toBe('');
    expect(t('runs', 'stageExplainFinalized')).not.toBe('');
    expect(t('runs', 'sidebarToggle')).not.toBe('');
    expect(t('runs', 'helpTitle')).not.toBe('');
    expect(t('runs', 'shortcutPalette')).not.toBe('');
    expect(t('runs', 'glossaryExtract')).toContain('Extraction');
    expect(t('runs', 'glossaryAssessment')).toContain('Assessment');
  });

  it('resolves the new extraction primary-action keys', () => {
    expect(t('extraction', 'runHeaderFinishExtraction')).toBe('Finish extraction');
    expect(t('extraction', 'runHeaderExtractionFinished')).toBe('Extraction finished');
    expect(t('extraction', 'runHeaderStartConsensus')).toBe('Start consensus');
    expect(t('extraction', 'runHeaderFinishExtractionTooltip')).not.toBe('');
    expect(t('extraction', 'runHeaderFinalizeTooltip')).not.toBe('');
  });
});

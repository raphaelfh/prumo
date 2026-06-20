import { describe, expect, it } from 'vitest';
import { t } from '@/lib/copy';

describe('runs copy namespace', () => {
  it('resolves shared run-header keys', () => {
    expect(t('runs', 'revision')).toBe('Revision');
    expect(t('runs', 'stageConsensus')).toBe('Consensus');
    expect(t('runs', 'finalize')).toBe('Finalize');
  });

  it('resolves the new 3-node + help + sidebar keys', () => {
    expect(t('runs', 'stageExtract')).toBe('Extract');
    expect(t('runs', 'stageExtractTooltip')).not.toBe('');
    expect(t('runs', 'stageConsensusTooltip')).not.toBe('');
    expect(t('runs', 'stageFinalizedTooltip')).not.toBe('');
    expect(t('runs', 'sidebarToggle')).not.toBe('');
    expect(t('runs', 'helpTitle')).not.toBe('');
    expect(t('runs', 'shortcutPalette')).not.toBe('');
    expect(t('runs', 'glossaryExtract')).not.toBe('');
  });

  it('resolves the new extraction primary-action keys', () => {
    expect(t('extraction', 'runHeaderMarkReady')).toBe('Mark ready →');
    expect(t('extraction', 'runHeaderMarkReadyTooltip')).not.toBe('');
    expect(t('extraction', 'runHeaderFinalizeTooltip')).not.toBe('');
  });
});

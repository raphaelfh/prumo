import { describe, expect, it } from 'vitest';
import { extraction } from '@/lib/copy/extraction';

const REMOVED = [
  'exportNoData','exportNoDataHint','exportTitle','exportSubtitle','exportTemplate',
  'exportInstances','exportInstancesCreated','exportValues','exportValuesExtracted',
  'exportCompleteness','exportCompletenessOf','exportSettingsTitle','exportSettingsDesc',
  'exportFormatLabel','exportFormatCsv','exportFormatCsvDesc','exportFormatJson',
  'exportFormatJsonDesc','exportFormatExcel','exportFormatExcelDesc','exportIncludeOptions',
  'exportIncludeEvidence','exportIncludeMetadata','exportOnlyComplete','exportNoTemplate',
  'exportNoTemplateHint','dataPreviewTitle','dataPreviewDesc','valuesLabelShort',
  'moreExportData','moreExportDialogTitle','moreExportDialogDesc',
] as const;
const KEPT = ['exportButton', 'instancesCardTitle'] as const;

describe('extraction copy — legacy export keys removed', () => {
  it.each(REMOVED)('removed: %s', (k) => {
    expect(k in extraction).toBe(false);
  });
  it.each(KEPT)('kept (still referenced): %s', (k) => {
    expect(k in extraction).toBe(true);
  });
});
